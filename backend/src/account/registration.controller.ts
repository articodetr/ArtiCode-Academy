import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthThrottlerGuard } from '../auth/auth-throttler.guard.js';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { Public } from '../auth/decorators.js';
import {
  CompleteRegistrationDto,
  RegisterDto,
  RegistrationCompletedDto,
  RegistrationInvalidErrorDto,
  RegistrationPreviewDto,
} from './registration.dto.js';
import { RegistrationService } from './registration.service.js';
import { CompleteRegistrationThrottle, RegisterThrottle } from './registration.throttle.js';

/** 60 previews per minute per IP (a page load each), like an invitation preview. */
const PREVIEW_LIMIT = { login: { limit: 60, ttl: 60 * 1000 } };

const CLOSED = 'registration_disabled — `settings.selfRegistration.enabled` is not true, or the server has no mail transport (the `selfRegistration` flag of API-205)';

/**
 * PORTAL-03 (#207, contract v2) — a visitor creates their own student account:
 * name and e-mail first, the password only after the e-mailed link is opened.
 * Public routes, rate limited like the other account routes; the bodies are
 * checked by registration.rules.ts (raw JSON, so every refusal has the
 * contract's `registration_invalid { fields, unknown }` shape).
 */
@ApiTags('account')
@Controller('account/register')
@Public()
@UseGuards(AuthThrottlerGuard)
@ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited (`Retry-After-login`, or `Retry-After-register_ip` for the per-IP ceiling of the registration request and of the completion)' })
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RegisterThrottle()
  @ApiOperation({
    summary: 'Ask for a student account (public, self-registration)',
    description:
      'Always 202 with NO body once the body is valid and the academy takes registrations — whatever the address: the account is looked up only after the response. ' +
      'A new address gets a `pending` account without a password (the `student` role and a student profile) and the e-mail «أكمل إنشاء حسابك» with the link ' +
      '`<APP_PUBLIC_URL>/register/complete/<token>`; a pending self-registered account gets a fresh link (older ones retired, at most 3 per 15 minutes); ' +
      'any other account the notice «لديك حساب بالفعل» (a link to /login, nothing changes); a soft-deleted one nothing. The e-mails carry nothing the visitor typed. ' +
      'At most one «لديك حساب بالفعل» per account per 24 hours and 300 registration e-mails (links and notices) per 24 hours for the academy — past either, still 202 and nothing is sent. ' +
      'Limits: 5 per 15 minutes per (IP, e-mail) and 200 per hour per IP.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiAcceptedResponse({ description: 'Accepted — an e-mail is on its way to the address (which one, and whether, is never revealed)' })
  @ApiBadRequestResponse({ type: RegistrationInvalidErrorDto, description: 'registration_invalid { fields, unknown }' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: `${CLOSED} | origin_forbidden` })
  async register(@Body() body: unknown, @Req() req: Request): Promise<void> {
    await this.registration.register(body, requestContext(req));
  }

  @Get(':token')
  @Throttle(PREVIEW_LIMIT)
  @ApiOperation({
    summary: 'Preview a registration link (public)',
    description: 'What the page shows before the password is chosen: the name typed at registration, the masked address and the expiry.',
  })
  @ApiParam({ name: 'token', description: 'The raw token from the e-mailed link' })
  @ApiOkResponse({ type: RegistrationPreviewDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: CLOSED })
  @ApiNotFoundResponse({
    type: AuthErrorDto,
    description: 'registration_link_invalid (malformed, unknown, used, replaced, not a self-registration link, or the account can no longer be completed)',
  })
  @ApiGoneResponse({ type: AuthErrorDto, description: 'registration_link_expired (`expiresAt` in the body) — register again with the same address' })
  preview(@Param('token') token: string): Promise<RegistrationPreviewDto> {
    return this.registration.preview(token);
  }

  @Post(':token/complete')
  @HttpCode(HttpStatus.OK)
  @CompleteRegistrationThrottle()
  @ApiOperation({
    summary: 'Complete a registration: choose the password (public)',
    description:
      'Consumes the one-time link, stores the password (argon2id) and sets the account `active` with `emailVerifiedAt` — opening the e-mailed link proved the address. ' +
      'Opens NO session: the visitor signs in next. Records `users.self_registration.completed`. ' +
      'Limits: 20 per 15 minutes per (IP, link) and 200 per 15 minutes per IP.',
  })
  @ApiParam({ name: 'token', description: 'The raw token from the e-mailed link' })
  @ApiBody({ type: CompleteRegistrationDto })
  @ApiOkResponse({ type: RegistrationCompletedDto })
  @ApiBadRequestResponse({ description: 'registration_invalid { fields, unknown } (RegistrationInvalidErrorDto), or password_weak { problems } (the invitation password policy)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: `${CLOSED} | origin_forbidden` })
  @ApiNotFoundResponse({ type: AuthErrorDto, description: 'registration_link_invalid' })
  @ApiGoneResponse({ type: AuthErrorDto, description: 'registration_link_expired' })
  complete(@Param('token') token: string, @Body() body: unknown, @Req() req: Request): Promise<RegistrationCompletedDto> {
    return this.registration.complete(token, body, requestContext(req));
  }
}
