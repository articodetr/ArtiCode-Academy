import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthThrottlerGuard } from '../auth/auth-throttler.guard.js';
import { AuthErrorDto, SessionResponseDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import type { RefreshCookieOptions } from '../auth/cookies.js';
import { Public } from '../auth/decorators.js';
import { presentSession, sessionCookieOptions } from '../auth/session.presenter.js';
import { TokenService } from '../auth/token.service.js';
import type { Env } from '../config/env.schema.js';
import {
  CompleteRegistrationDto,
  RegisterDto,
  RegistrationInvalidErrorDto,
  RegistrationPasswordIncorrectErrorDto,
  RegistrationPreviewDto,
} from './registration.dto.js';
import { RegistrationService } from './registration.service.js';
import { CompleteRegistrationThrottle, RegisterThrottle } from './registration.throttle.js';

/** 60 previews per minute per IP (a page load each), like an invitation preview. */
const PREVIEW_LIMIT = { login: { limit: 60, ttl: 60 * 1000 } };

const CLOSED = 'registration_disabled — `settings.selfRegistration.enabled` is not true (the `selfRegistration` flag of API-205)';

/**
 * PORTAL-03/04 (#207) — a visitor creates their own student account: name,
 * e-mail and password on /register create an ACTIVE student account and sign
 * the visitor in at once (no e-mail, no link, no approval). The two
 * `:token` routes are LEGACY: they complete the pending accounts the earlier
 * e-mailed flow left behind. Public routes, rate limited like the other account
 * routes; the bodies are checked by registration.rules.ts (raw JSON, so every
 * refusal has the contract's `registration_invalid { fields, unknown }` shape).
 */
@ApiTags('account')
@Controller('account/register')
@Public()
@UseGuards(AuthThrottlerGuard)
@ApiExtraModels(RegistrationInvalidErrorDto, RegistrationPasswordIncorrectErrorDto, AuthErrorDto)
@ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited (`Retry-After-login`, or `Retry-After-register_ip` for the per-IP ceiling of the registration request and of the completion)' })
export class RegistrationController {
  private readonly cookie: RefreshCookieOptions;

  constructor(
    private readonly registration: RegistrationService,
    tokens: TokenService,
    config: ConfigService<Env, true>,
  ) {
    this.cookie = sessionCookieOptions(config, tokens);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RegisterThrottle()
  @ApiOperation({
    summary: 'Create a student account and sign in (public, self-registration)',
    description:
      'Open only while `settings.selfRegistration.enabled` is true (the `selfRegistration` flag of API-205; no mail transport needed). ' +
      'Checks, in order: open (403 `registration_disabled`), the body (400 `registration_invalid { fields, unknown }` — any field but fullName/email/password/locale is refused, ' +
      'so nothing in the body can choose a role, a permission or an academy), the password policy (400 `password_weak { problems }`), ' +
      'the address (409 `email_in_use` when ANY account already has it — active, pending, invited, suspended, archived or soft-deleted; that account is not changed and nothing is sent). ' +
      'Then, in one transaction, an ACTIVE account with the chosen password, the `student` role only and an empty student profile, marked `selfRegisteredAt`, ' +
      'with the address NOT confirmed (`emailVerifiedAt` null — it was never proven, so Google sign-in never links it by its e-mail), and the event ' +
      '`users.self_registered { via: email }`; then a session opens exactly like login (access token + httpOnly refresh cookie, `auth.login.succeeded { via: self_registration }`). ' +
      'No confirmation e-mail, no link, no approval: later sign-ins use POST /api/auth/login with the same password. ' +
      'Limits: 5 per 15 minutes per (IP, e-mail) and 60 per hour per IP.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({ type: SessionResponseDto, description: 'Created — the new student is signed in (the refresh token is in the httpOnly cookie, never the body)' })
  @ApiBadRequestResponse({
    description: 'registration_invalid { fields, unknown } (RegistrationInvalidErrorDto), or password_weak { problems } (the invitation password policy)',
    schema: { oneOf: [{ $ref: getSchemaPath(RegistrationInvalidErrorDto) }, { $ref: getSchemaPath(AuthErrorDto) }] },
  })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: `${CLOSED} | origin_forbidden` })
  @ApiConflictResponse({ type: AuthErrorDto, description: 'email_in_use { field: email } — the address already has an account; sign in or reset the password instead' })
  async register(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionResponseDto> {
    const session = await this.registration.register(body, requestContext(req));
    return presentSession(res, session, this.cookie);
  }

  @Get(':token')
  @Throttle(PREVIEW_LIMIT)
  @ApiOperation({
    summary: 'Preview a registration link (public, legacy)',
    description:
      'LEGACY — for the pending accounts the earlier e-mailed registration left behind (no new link is sent any more). ' +
      'What the page shows before the password is typed: the name typed at registration, the masked address and the expiry.',
  })
  @ApiParam({ name: 'token', description: 'The raw token from the e-mailed link' })
  @ApiOkResponse({ type: RegistrationPreviewDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: CLOSED })
  @ApiNotFoundResponse({
    type: AuthErrorDto,
    description: 'registration_link_invalid (malformed, unknown, used, replaced, retired, not a self-registration link, or the account can no longer be completed)',
  })
  @ApiGoneResponse({ type: AuthErrorDto, description: 'registration_link_expired (`expiresAt` in the body) — the pending account stays; an administrator deletes it to free the address' })
  preview(@Param('token') token: string): Promise<RegistrationPreviewDto> {
    return this.registration.preview(token);
  }

  @Post(':token/complete')
  @HttpCode(HttpStatus.OK)
  @CompleteRegistrationThrottle()
  @ApiOperation({
    summary: 'Complete a registration: type the password chosen at registration, and sign in (public, legacy)',
    description:
      'LEGACY — completes a pending account of the earlier e-mailed registration (no new such account is created). Checks, in order: open (403), the link (404/410), the body (400 `registration_invalid`), then the typed password against the one chosen at registration: ' +
      'a wrong one → 400 `registration_password_incorrect { attemptsLeft }` (the 5th retires the link; the next try is 404). ' +
      'The right one consumes the one-time link, sets the account `active` with `emailVerifiedAt` — opening the e-mailed link proved the address — and opens a session exactly like login ' +
      '(access token + httpOnly refresh cookie). Records `users.self_registration.completed` and `auth.login.succeeded { via: self_registration }`. ' +
      'Limits: 20 per 15 minutes per (IP, link) and 200 per 15 minutes per IP.',
  })
  @ApiParam({ name: 'token', description: 'The raw token from the e-mailed link' })
  @ApiBody({ type: CompleteRegistrationDto })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiBadRequestResponse({
    description: 'registration_invalid { fields, unknown } (RegistrationInvalidErrorDto), or registration_password_incorrect { attemptsLeft } (RegistrationPasswordIncorrectErrorDto)',
    schema: { oneOf: [{ $ref: getSchemaPath(RegistrationInvalidErrorDto) }, { $ref: getSchemaPath(RegistrationPasswordIncorrectErrorDto) }] },
  })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: `${CLOSED} | origin_forbidden` })
  @ApiNotFoundResponse({ type: AuthErrorDto, description: 'registration_link_invalid' })
  @ApiGoneResponse({ type: AuthErrorDto, description: 'registration_link_expired' })
  async complete(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto> {
    const session = await this.registration.complete(token, body, requestContext(req));
    return presentSession(res, session, this.cookie);
  }
}
