// MOD-18-T03 — the session routes of the platform API (API-178..182, roadmap
// §4m.4), the academy MOD-01 AuthController (src/auth/auth.controller.ts) on
// the platform's accounts, tokens and `pla_refresh` cookie. Rate limits per
// route through PlatformThrottlerGuard (method-level, so me/logout are never
// throttled). Since PMFA-T03 (roadmap §4o) API-178 answers the challenge of
// the second step for an account with MFA, and API-218 `POST
// /api/auth/login/mfa` finishes it (the academy API-005 / API-211).
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { RefreshCookieOptions } from '../../auth/cookies.js';
import { requestContext } from '../../auth/cookies.js';
import type { PlatformEnv } from '../platform.env.schema.js';
import { platformAuthError } from '../platform.errors.js';
import {
  clearPlatformRefreshCookie,
  platformRefreshCookieOptions,
  presentPlatformSession,
  readPlatformRefreshCookie,
} from './platform-cookies.js';
import { CurrentPlatformUser, Public } from './platform.decorators.js';
import { isPendingPlatformMfa, toPlatformMfaChallengeResponse } from './platform-mfa-login.rules.js';
import type { PlatformPrincipal } from './platform-principal.js';
import {
  PlatformAuthErrorDto,
  PlatformChangePasswordDto,
  PlatformLoginDto,
  PlatformMfaChallengeResponseDto,
  PlatformMfaLoginDto,
  PlatformSessionResponseDto,
  PlatformUserDto,
} from './platform-session.dto.js';
import { PlatformSessionService } from './platform-session.service.js';
import { PLATFORM_AUTH_THROTTLER, PlatformThrottlerGuard } from './platform-throttler.guard.js';
import { PlatformTokenService } from './platform-token.service.js';

const MINUTE_MS = 60 * 1000;
const LOCKED_STATUS = 423;
/**
 * 10 sign-ins per 15 minutes per (IP, identifier) — the academy LOGIN_LIMIT.
 * The second step (API-218) carries no identifier and no signed-in user:
 * PlatformThrottlerGuard counts it per (IP, challenge), as the academy does.
 */
export const PLATFORM_LOGIN_LIMIT = { [PLATFORM_AUTH_THROTTLER]: { limit: 10, ttl: 15 * MINUTE_MS } };
/** 30 refreshes per minute per IP — the academy REFRESH_LIMIT. */
export const PLATFORM_REFRESH_LIMIT = { [PLATFORM_AUTH_THROTTLER]: { limit: 30, ttl: MINUTE_MS } };
/** 10 password changes per 15 minutes per (IP, platform user). */
export const PLATFORM_PASSWORD_LIMIT = { [PLATFORM_AUTH_THROTTLER]: { limit: 10, ttl: 15 * MINUTE_MS } };

@ApiTags('auth')
@Controller('auth')
export class PlatformSessionController {
  private readonly cookie: RefreshCookieOptions;

  constructor(
    private readonly sessions: PlatformSessionService,
    tokens: PlatformTokenService,
    config: ConfigService<PlatformEnv, true>,
  ) {
    this.cookie = platformRefreshCookieOptions(config, tokens);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformThrottlerGuard)
  @Throttle(PLATFORM_LOGIN_LIMIT)
  @ApiOperation({
    summary: 'Sign in to the platform with e-mail and password (API-178)',
    description:
      'Returns a short-lived platform access token and sets the httpOnly refresh cookie `pla_refresh` (path `/api/auth`, SameSite=Strict). PLATFORM_LOCKOUT_THRESHOLD failures lock the account for PLATFORM_LOCKOUT_MINUTES; a lock blocks new sign-ins only. ' +
      'For an account with two-step verification (PMFA-T03) a correct password opens NO session: the answer is `{ mfaRequired: true, challenge, expiresAt }` without a cookie and without an event, ' +
      'and the failed-sign-in counter is not reset — finish with `POST /api/auth/login/mfa`. Without the server key such an account gets `503 mfa_unavailable` (never a session without the second factor).',
  })
  @ApiExtraModels(PlatformSessionResponseDto, PlatformMfaChallengeResponseDto)
  @ApiOkResponse({
    description:
      'A session (`PlatformSessionResponseDto`, with the cookie), or for an account with MFA the challenge of the second step (`PlatformMfaChallengeResponseDto`, no cookie)',
    schema: { oneOf: [{ $ref: getSchemaPath(PlatformSessionResponseDto) }, { $ref: getSchemaPath(PlatformMfaChallengeResponseDto) }] },
  })
  @ApiUnauthorizedResponse({ type: PlatformAuthErrorDto, description: 'invalid_credentials' })
  @ApiForbiddenResponse({ type: PlatformAuthErrorDto, description: 'account_suspended | origin_forbidden' })
  @ApiResponse({ status: LOCKED_STATUS, type: PlatformAuthErrorDto, description: 'account_locked { retryAfterSeconds }' })
  @ApiTooManyRequestsResponse({ type: PlatformAuthErrorDto, description: 'rate_limited' })
  @ApiServiceUnavailableResponse({
    type: PlatformAuthErrorDto,
    description: 'mfa_unavailable — the account has MFA and the server has no usable PLATFORM_MFA_ENCRYPTION_KEY, or the account secret does not open with it',
  })
  async login(
    @Body() body: PlatformLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlatformSessionResponseDto | PlatformMfaChallengeResponseDto> {
    const outcome = await this.sessions.login(body.identifier, body.password, requestContext(req));
    if (isPendingPlatformMfa(outcome)) return toPlatformMfaChallengeResponse(outcome);
    return presentPlatformSession(res, outcome, this.cookie);
  }

  @Post('login/mfa')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformThrottlerGuard)
  @Throttle(PLATFORM_LOGIN_LIMIT)
  @ApiOperation({
    summary: 'Second step of a two-step platform sign-in: the challenge plus a code (API-218)',
    description:
      'Sends the `challenge` that POST /api/auth/login answered, with EXACTLY one factor: `code` (the current 6-digit TOTP code) or `recoveryCode` (used up). ' +
      'On success the challenge is consumed and a session opens exactly like login (access token + httpOnly `pla_refresh` cookie; `platform.auth.login.succeeded { via: mfa | recovery_code }`). ' +
      'A wrong, replayed or used code counts against the challenge (5 per challenge, then it is consumed) AND against the account lockout of the password (PLATFORM_LOCKOUT_THRESHOLD failures lock it for PLATFORM_LOCKOUT_MINUTES; `platform.auth.login.failed { reason: invalid_mfa_code }`). ' +
      'A challenge lives 5 minutes, works once, and dies when the password changes. Rate limited: 10 per 15 minutes per (IP, challenge).',
  })
  @ApiOkResponse({ type: PlatformSessionResponseDto })
  @ApiBadRequestResponse({ type: PlatformAuthErrorDto, description: 'Validation failed, or mfa_factor_required (none or both of `code` / `recoveryCode`)' })
  @ApiUnauthorizedResponse({
    type: PlatformAuthErrorDto,
    description:
      'mfa_challenge_invalid (malformed, unknown, used, expired, exhausted, issued before the last password change, or MFA is off for the account — sign in with the password again) | mfa_code_invalid (wrong, replayed or used code)',
  })
  @ApiForbiddenResponse({ type: PlatformAuthErrorDto, description: 'account_suspended | origin_forbidden' })
  @ApiResponse({ status: LOCKED_STATUS, type: PlatformAuthErrorDto, description: 'account_locked { retryAfterSeconds } — locked before this request, or by this wrong code' })
  @ApiTooManyRequestsResponse({ type: PlatformAuthErrorDto, description: 'rate_limited' })
  @ApiServiceUnavailableResponse({
    type: PlatformAuthErrorDto,
    description: 'mfa_unavailable — no usable PLATFORM_MFA_ENCRYPTION_KEY, or the account secret does not open with it',
  })
  async loginMfa(
    @Body() body: PlatformMfaLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlatformSessionResponseDto> {
    const session = await this.sessions.loginWithMfa(
      body.challenge,
      { code: body.code, recoveryCode: body.recoveryCode },
      requestContext(req),
    );
    return presentPlatformSession(res, session, this.cookie);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformThrottlerGuard)
  @Throttle(PLATFORM_REFRESH_LIMIT)
  @ApiOperation({
    summary: 'Rotate the platform refresh token and get a new access token (API-179)',
    description:
      'Reads the `pla_refresh` cookie only (an academy `aca_refresh` is ignored). The presented token is retired and a successor set; presenting a retired token again revokes every session of that sign-in. On any refusal the cookie is cleared.',
  })
  @ApiOkResponse({ type: PlatformSessionResponseDto })
  @ApiUnauthorizedResponse({
    type: PlatformAuthErrorDto,
    description: 'refresh_missing | refresh_invalid | refresh_expired | refresh_reused',
  })
  @ApiForbiddenResponse({ type: PlatformAuthErrorDto, description: 'account_suspended | origin_forbidden' })
  @ApiTooManyRequestsResponse({ type: PlatformAuthErrorDto, description: 'rate_limited' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<PlatformSessionResponseDto> {
    const token = readPlatformRefreshCookie(req);
    if (!token) {
      clearPlatformRefreshCookie(res, this.cookie);
      throw platformAuthError.refreshMissing();
    }
    try {
      const session = await this.sessions.refresh(token, requestContext(req));
      return presentPlatformSession(res, session, this.cookie);
    } catch (error) {
      clearPlatformRefreshCookie(res, this.cookie);
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sign out of this device (API-180)',
    description: 'Revokes the session (refresh family) behind the `pla_refresh` cookie and clears it. Always 204.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: PlatformAuthErrorDto, description: 'origin_forbidden' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.logout(readPlatformRefreshCookie(req), requestContext(req));
    clearPlatformRefreshCookie(res, this.cookie);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sign out of every device',
    description: 'Revokes every refresh token of the caller and clears the cookie. Access tokens already issued live until they expire.',
  })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ type: PlatformAuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
  async logoutAll(
    @CurrentPlatformUser() user: PlatformPrincipal,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.logoutAll(user.id, requestContext(req));
    clearPlatformRefreshCookie(res, this.cookie);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in platform account (API-181)' })
  @ApiOkResponse({ type: PlatformUserDto })
  @ApiUnauthorizedResponse({ type: PlatformAuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
  @ApiForbiddenResponse({ type: PlatformAuthErrorDto, description: 'account_suspended' })
  me(@CurrentPlatformUser() user: PlatformPrincipal): Promise<PlatformUserDto> {
    return this.sessions.me(user);
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PlatformThrottlerGuard)
  @Throttle(PLATFORM_PASSWORD_LIMIT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change own platform password (API-182)',
    description:
      'Verifies the current password, stores the new Argon2id hash and revokes every other session of the caller. Access tokens issued before the change stop working; the current `pla_refresh` cookie keeps working, so refresh to continue.',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: PlatformAuthErrorDto, description: 'password_invalid | password_weak { problems }' })
  @ApiUnauthorizedResponse({ type: PlatformAuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
  @ApiTooManyRequestsResponse({ type: PlatformAuthErrorDto, description: 'rate_limited' })
  async changePassword(
    @CurrentPlatformUser() user: PlatformPrincipal,
    @Body() body: PlatformChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.sessions.changePassword(
      user.id,
      body.currentPassword,
      body.newPassword,
      readPlatformRefreshCookie(req),
      requestContext(req),
    );
  }
}
