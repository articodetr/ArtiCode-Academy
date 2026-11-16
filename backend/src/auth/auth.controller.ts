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
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.schema.js';
import { AuthThrottlerGuard } from './auth-throttler.guard.js';
import { authError } from './auth.errors.js';
import {
  AuthErrorDto,
  AuthUserDto,
  ChangePasswordDto,
  LoginDto,
  MfaChallengeResponseDto,
  MfaLoginDto,
  SessionResponseDto,
} from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { clearRefreshCookie, readRefreshCookie, requestContext } from './cookies.js';
import type { RefreshCookieOptions } from './cookies.js';
import { CurrentUser, Public } from './decorators.js';
import { isPendingMfa, toMfaChallengeResponse } from './mfa-login.rules.js';
import type { AuthPrincipal } from './principal.js';
import { presentSession, sessionCookieOptions, toUserDto } from './session.presenter.js';
import { TokenService } from './token.service.js';

/**
 * 10 attempts per 15 minutes per (IP, identifier). The second sign-in step
 * (API-211) carries no identifier, so AuthThrottlerGuard counts it per
 * (IP, challenge); the password change per (IP, user).
 */
const LOGIN_LIMIT = { login: { limit: 10, ttl: 15 * 60 * 1000 } };
const LOCKED_STATUS = 423;
/** 30 refreshes per minute per IP. */
const REFRESH_LIMIT = { login: { limit: 30, ttl: 60 * 1000 } };

@ApiTags('auth')
@Controller('auth')
@UseGuards(AuthThrottlerGuard)
export class AuthController {
  private readonly cookie: RefreshCookieOptions;

  constructor(
    private readonly auth: AuthService,
    tokens: TokenService,
    config: ConfigService<Env, true>,
  ) {
    this.cookie = sessionCookieOptions(config, tokens);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(LOGIN_LIMIT)
  @ApiOperation({
    summary: 'Sign in with e-mail or username',
    description:
      'Returns a short-lived access token and sets the httpOnly refresh cookie (`aca_refresh`, path `/api/auth`, SameSite=Strict). Five failures lock the account for 15 minutes (configurable). ' +
      'For an account with two-step verification (MFA-T03, D-R109) a correct password opens NO session: the answer is `{ mfaRequired: true, challenge, expiresAt }` without a cookie and without an event, ' +
      'and the failed-login counter is not reset — finish with `POST /api/auth/login/mfa`. Without the server key such an account gets `503 mfa_unavailable` (never a session without the second factor).',
  })
  @ApiExtraModels(SessionResponseDto, MfaChallengeResponseDto)
  @ApiOkResponse({
    description: 'A session (`SessionResponseDto`, with the cookie), or for an account with MFA the challenge of the second step (`MfaChallengeResponseDto`, no cookie)',
    schema: { oneOf: [{ $ref: getSchemaPath(SessionResponseDto) }, { $ref: getSchemaPath(MfaChallengeResponseDto) }] },
  })
  @ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'invalid_credentials' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'account_not_activated | account_pending | account_suspended | origin_forbidden' })
  @ApiResponse({ status: LOCKED_STATUS, type: AuthErrorDto, description: 'account_locked (`retryAfterSeconds`)' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  @ApiServiceUnavailableResponse({ type: AuthErrorDto, description: 'mfa_unavailable — the account has MFA and the server has no usable AUTH_MFA_ENCRYPTION_KEY' })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto | MfaChallengeResponseDto> {
    const outcome = await this.auth.login(body.identifier, body.password, requestContext(req));
    if (isPendingMfa(outcome)) return toMfaChallengeResponse(outcome);
    return presentSession(res, outcome, this.cookie);
  }

  @Post('login/mfa')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(LOGIN_LIMIT)
  @ApiOperation({
    summary: 'Second step of a two-step sign-in: the challenge plus a code (API-211)',
    description:
      'Sends the `challenge` that POST /api/auth/login (or a confirmed password reset) answered, with EXACTLY one factor: `code` (the current 6-digit TOTP code) or `recoveryCode` (used up). ' +
      'On success the challenge is consumed and a session opens exactly like login (access token + httpOnly refresh cookie; `auth.login.succeeded { via: mfa | recovery_code }`). ' +
      'A wrong, replayed or used code counts against the challenge (5 per challenge, then it is consumed) AND against the account lockout of the password (5 failures lock it for 15 minutes; `auth.login.failed { stage: mfa }`). ' +
      'A challenge lives 5 minutes, works once, and dies when the password changes. Rate limited per IP.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiBadRequestResponse({ type: AuthErrorDto, description: 'Validation failed, or mfa_factor_required (none or both of `code` / `recoveryCode`)' })
  @ApiUnauthorizedResponse({
    type: AuthErrorDto,
    description:
      'mfa_challenge_invalid (malformed, unknown, used, expired, exhausted, issued before the last password change, or MFA is off for the account — sign in with the password again) | mfa_code_invalid (wrong, replayed or used code)',
  })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'account_not_activated | account_pending | account_suspended | origin_forbidden' })
  @ApiResponse({ status: LOCKED_STATUS, type: AuthErrorDto, description: 'account_locked (`retryAfterSeconds`) — locked before this request, or by this wrong code' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  @ApiServiceUnavailableResponse({ type: AuthErrorDto, description: 'mfa_unavailable — no usable AUTH_MFA_ENCRYPTION_KEY, or the account’s secret does not open with it' })
  async loginMfa(
    @Body() body: MfaLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto> {
    const session = await this.auth.loginWithMfa(body.challenge, { code: body.code, recoveryCode: body.recoveryCode }, requestContext(req));
    return presentSession(res, session, this.cookie);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(REFRESH_LIMIT)
  @ApiOperation({
    summary: 'Rotate the refresh token and get a new access token',
    description:
      'Reads the `aca_refresh` cookie. The presented token is retired and a new one is set; presenting a retired token again revokes every session of that login.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'refresh_missing | refresh_invalid | refresh_expired | refresh_reused | session_invalid' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionResponseDto> {
    const token = readRefreshCookie(req);
    if (!token) {
      clearRefreshCookie(res, this.cookie);
      throw authError.refreshMissing();
    }
    try {
      const session = await this.auth.refresh(token, requestContext(req));
      return presentSession(res, session, this.cookie);
    } catch (error) {
      clearRefreshCookie(res, this.cookie);
      throw error;
    }
  }

  @Post('logout')
  @Public()
  // The throttler is named "login" (app.module.ts): a bare @SkipThrottle() skips only "default" (KI-082).
  @SkipThrottle({ login: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out of this device', description: 'Revokes the session behind the refresh cookie and clears it. Always 204.' })
  @ApiNoContentResponse()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req), requestContext(req));
    clearRefreshCookie(res, this.cookie);
  }

  @Post('logout-all')
  // The throttler is named "login" (app.module.ts): a bare @SkipThrottle() skips only "default" (KI-082).
  @SkipThrottle({ login: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out of every device', description: 'Revokes all refresh tokens of the caller and clears the cookie.' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ type: AuthErrorDto })
  async logoutAll(
    @CurrentUser() user: AuthPrincipal,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutAll(user.id, requestContext(req));
    clearRefreshCookie(res, this.cookie);
  }

  @Get('me')
  // The throttler is named "login" (app.module.ts): a bare @SkipThrottle() skips only "default" (KI-082).
  @SkipThrottle({ login: true })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user with roles and permissions' })
  @ApiOkResponse({ type: AuthUserDto })
  @ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
  me(@CurrentUser() user: AuthPrincipal): AuthUserDto {
    return toUserDto(user);
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(LOGIN_LIMIT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change own password',
    description: 'Verifies the current password, stores the new argon2id hash and revokes every other session. Access tokens issued before the change stop working; the current refresh cookie keeps working.',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: AuthErrorDto, description: 'password_invalid | password_weak' })
  async changePassword(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword, readRefreshCookie(req), requestContext(req));
  }
}
