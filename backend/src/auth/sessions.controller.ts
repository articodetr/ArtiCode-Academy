import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.schema.js';
import { AuthErrorDto } from './auth.dto.js';
import { clearRefreshCookie, readRefreshCookie, requestContext } from './cookies.js';
import type { RefreshCookieOptions } from './cookies.js';
import { CurrentUser } from './decorators.js';
import type { AuthPrincipal } from './principal.js';
import { sessionCookieOptions } from './session.presenter.js';
import { SessionListDto } from './sessions.dto.js';
import { SessionsService } from './sessions.service.js';
import { TokenService } from './token.service.js';

/**
 * MOD-01-H06 — the caller's active sessions (API-201) and revoking one of them
 * (API-202). Both routes sit behind the global AuthGuard (a Bearer access
 * token, no permission key: ownership only), and the DELETE behind OriginGuard.
 *
 * The routes live under `/api/auth`, so the browser sends the `aca_refresh`
 * cookie (Path=/api/auth) with them; it only tells which session is this
 * device's and is never required.
 *
 * Not rate-limited: unlike AuthController this controller is not under
 * AuthThrottlerGuard (no ThrottlerGuard is global — app.module.ts), so it needs
 * no `@SkipThrottle({ login: true })` (KI-082). Both routes need a valid access
 * token and guess no credential, like `/me` and `logout-all`, which are exempt.
 */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/sessions')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class SessionsController {
  private readonly cookie: RefreshCookieOptions;

  constructor(
    private readonly sessions: SessionsService,
    tokens: TokenService,
    config: ConfigService<Env, true>,
  ) {
    this.cookie = sessionCookieOptions(config, tokens);
  }

  @Get()
  @ApiOperation({
    summary: 'List my active sessions',
    description:
      'One item per signed-in device: every refresh-token family of the caller that still has a live refresh token (not revoked, not rotated, not expired, the family before its absolute deadline), newest activity first. ' +
      '`current` marks the session of the `aca_refresh` cookie sent with the request. Never a token or a hash. No permission key; no audit event.',
  })
  @ApiOkResponse({ type: SessionListDto })
  list(@CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<SessionListDto> {
    return this.sessions.list(caller, readRefreshCookie(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sign out one of my sessions',
    description:
      'Revokes every refresh token of the caller’s session `id` (the `id` of an item of `GET /api/auth/sessions`): that device can no longer refresh. ' +
      'Revoking the current session also clears the `aca_refresh` cookie, like logout. Access tokens already issued for that session stay valid until they expire (15 minutes by default). ' +
      'Records one `auth.session.revoked` event.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The session id (refresh-token family id)' })
  @ApiNoContentResponse({ description: 'Revoked' })
  @ApiBadRequestResponse({ description: '`id` is not a UUID' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'origin_forbidden' })
  @ApiNotFoundResponse({ type: AuthErrorDto, description: 'session_not_found — not a session of the caller, or it has no live refresh token (revoked, expired or past its deadline)' })
  async revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const { current } = await this.sessions.revoke(caller, id, readRefreshCookie(req), requestContext(req));
    if (current) clearRefreshCookie(res, this.cookie);
  }
}
