import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.schema.js';
import { AuthThrottlerGuard } from './auth-throttler.guard.js';
import { authError } from './auth.errors.js';
import { AuthErrorDto, AuthUserDto, ChangePasswordDto, LoginDto, SessionResponseDto } from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { clearRefreshCookie, readRefreshCookie, requestContext } from './cookies.js';
import type { RefreshCookieOptions } from './cookies.js';
import { CurrentUser, Public } from './decorators.js';
import type { AuthPrincipal } from './principal.js';
import { presentSession, sessionCookieOptions, toUserDto } from './session.presenter.js';
import { TokenService } from './token.service.js';

/** 10 attempts per 15 minutes per (IP, identifier). */
const LOGIN_LIMIT = { login: { limit: 10, ttl: 15 * 60 * 1000 } };
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
      'Returns a short-lived access token and sets the httpOnly refresh cookie (`aca_refresh`, path `/api/auth`, SameSite=Strict). Five failures lock the account for 15 minutes (configurable).',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'invalid_credentials' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'account_not_activated | account_pending | account_suspended' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto> {
    const session = await this.auth.login(body.identifier, body.password, requestContext(req));
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
  @SkipThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out of this device', description: 'Revokes the session behind the refresh cookie and clears it. Always 204.' })
  @ApiNoContentResponse()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req), requestContext(req));
    clearRefreshCookie(res, this.cookie);
  }

  @Post('logout-all')
  @SkipThrottle()
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
  @SkipThrottle()
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
