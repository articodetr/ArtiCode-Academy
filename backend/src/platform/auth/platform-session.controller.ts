// MOD-18-T03 — the session routes of the platform API (API-178..182, roadmap
// §4m.4), the academy MOD-01 AuthController (src/auth/auth.controller.ts) on
// the platform's accounts, tokens and `pla_refresh` cookie. Rate limits per
// route through PlatformThrottlerGuard (method-level, so me/logout are never
// throttled).
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
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
import type { PlatformPrincipal } from './platform-principal.js';
import {
  PlatformAuthErrorDto,
  PlatformChangePasswordDto,
  PlatformLoginDto,
  PlatformSessionResponseDto,
  PlatformUserDto,
} from './platform-session.dto.js';
import { PlatformSessionService } from './platform-session.service.js';
import { PLATFORM_AUTH_THROTTLER, PlatformThrottlerGuard } from './platform-throttler.guard.js';
import { PlatformTokenService } from './platform-token.service.js';

const MINUTE_MS = 60 * 1000;
/** 10 sign-ins per 15 minutes per (IP, identifier) — the academy LOGIN_LIMIT. */
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
      'Returns a short-lived platform access token and sets the httpOnly refresh cookie `pla_refresh` (path `/api/auth`, SameSite=Strict). PLATFORM_LOCKOUT_THRESHOLD failures lock the account for PLATFORM_LOCKOUT_MINUTES; a lock blocks new sign-ins only.',
  })
  @ApiOkResponse({ type: PlatformSessionResponseDto })
  @ApiUnauthorizedResponse({ type: PlatformAuthErrorDto, description: 'invalid_credentials' })
  @ApiForbiddenResponse({ type: PlatformAuthErrorDto, description: 'account_suspended | origin_forbidden' })
  @ApiResponse({ status: 423, type: PlatformAuthErrorDto, description: 'account_locked { retryAfterSeconds }' })
  @ApiTooManyRequestsResponse({ type: PlatformAuthErrorDto, description: 'rate_limited' })
  async login(
    @Body() body: PlatformLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlatformSessionResponseDto> {
    const session = await this.sessions.login(body.identifier, body.password, requestContext(req));
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
