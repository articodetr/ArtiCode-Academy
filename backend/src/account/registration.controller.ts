import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
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

const CLOSED = 'registration_disabled — `settings.selfRegistration.enabled` is not true, or the server has no mail transport (the `selfRegistration` flag of API-205)';

/**
 * PORTAL-03/04 (#207, contract v3) — a visitor creates their own student
 * account: name, e-mail and password on /register; the e-mailed link then
 * activates it — only with that same password — and signs the visitor in.
 * Public routes, rate limited like the other account routes; the bodies are
 * checked by registration.rules.ts (raw JSON, so every refusal has the
 * contract's `registration_invalid { fields, unknown }` shape).
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
  @HttpCode(HttpStatus.ACCEPTED)
  @RegisterThrottle()
  @ApiOperation({
    summary: 'Ask for a student account (public, self-registration)',
    description:
      'Checks, in order: open (403 `registration_disabled`), the body (400 `registration_invalid`), the password policy (400 `password_weak` — about the typed password alone). ' +
      'Then always 202 with NO body, whatever the address: the password is hashed and the account looked up only after the response. ' +
      'A new address gets a `pending` account with that password (the `student` role and a student profile) and the e-mail «أكّد بريدك الإلكتروني لإكمال إنشاء حسابك» with the link ' +
      '`<APP_PUBLIC_URL>/register/complete/<token>`; a pending self-registered account gets the NEW password (the latest registration wins) and a fresh link (older ones retired, at most 3 per 15 minutes); ' +
      'any other account the notice «لديك حساب بالفعل» (a link to /login, nothing changes); a soft-deleted one nothing. The e-mails carry nothing the visitor typed. ' +
      'At most one «لديك حساب بالفعل» per account per 24 hours and 300 registration e-mails (links and notices) per 24 hours for the academy — past either, still 202 and nothing is sent or changed. ' +
      'Signing in before the link is opened answers `403 email_not_verified` once the password matched. ' +
      'Limits: 5 per 15 minutes per (IP, e-mail) and 200 per hour per IP.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiAcceptedResponse({ description: 'Accepted — an e-mail is on its way to the address (which one, and whether, is never revealed)' })
  @ApiBadRequestResponse({
    description: 'registration_invalid { fields, unknown } (RegistrationInvalidErrorDto), or password_weak { problems } (the invitation password policy)',
    schema: { oneOf: [{ $ref: getSchemaPath(RegistrationInvalidErrorDto) }, { $ref: getSchemaPath(AuthErrorDto) }] },
  })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: `${CLOSED} | origin_forbidden` })
  async register(@Body() body: unknown, @Req() req: Request): Promise<void> {
    await this.registration.register(body, requestContext(req));
  }

  @Get(':token')
  @Throttle(PREVIEW_LIMIT)
  @ApiOperation({
    summary: 'Preview a registration link (public)',
    description: 'What the page shows before the password is typed: the name typed at registration, the masked address and the expiry.',
  })
  @ApiParam({ name: 'token', description: 'The raw token from the e-mailed link' })
  @ApiOkResponse({ type: RegistrationPreviewDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: CLOSED })
  @ApiNotFoundResponse({
    type: AuthErrorDto,
    description: 'registration_link_invalid (malformed, unknown, used, replaced, retired, not a self-registration link, or the account can no longer be completed)',
  })
  @ApiGoneResponse({ type: AuthErrorDto, description: 'registration_link_expired (`expiresAt` in the body) — register again with the same address' })
  preview(@Param('token') token: string): Promise<RegistrationPreviewDto> {
    return this.registration.preview(token);
  }

  @Post(':token/complete')
  @HttpCode(HttpStatus.OK)
  @CompleteRegistrationThrottle()
  @ApiOperation({
    summary: 'Complete a registration: type the password chosen at registration, and sign in (public)',
    description:
      'Checks, in order: open (403), the link (404/410), the body (400 `registration_invalid`), then the typed password against the one chosen at registration: ' +
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
