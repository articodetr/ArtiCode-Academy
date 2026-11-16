// MOD-01-H06 for the platform — the caller's active sessions (API-203) and
// signing out one of them (API-204), the academy SessionsController
// (src/auth/sessions.controller.ts, API-201/202) on the platform's accounts and
// its `pla_refresh` cookie.
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
import type { RefreshCookieOptions } from '../../auth/cookies.js';
import { requestContext } from '../../auth/cookies.js';
import type { PlatformEnv } from '../platform.env.schema.js';
import {
  clearPlatformRefreshCookie,
  platformRefreshCookieOptions,
  readPlatformRefreshCookie,
} from './platform-cookies.js';
import { CurrentPlatformUser } from './platform.decorators.js';
import type { PlatformPrincipal } from './platform-principal.js';
import { PlatformAuthErrorDto } from './platform-session.dto.js';
import { PlatformSessionListDto } from './platform-sessions.dto.js';
import { PlatformSessionsService } from './platform-sessions.service.js';
import { PlatformTokenService } from './platform-token.service.js';

/**
 * Both routes sit behind the global PlatformAuthGuard (a platform Bearer
 * access token; no @PlatformRoles(), so `super_admin` and `support` alike —
 * ownership only), and the DELETE behind OriginGuard.
 *
 * The routes live under `/api/auth`, so the browser sends the `pla_refresh`
 * cookie (Path=/api/auth) with them; it only tells which session is this
 * device's and is never required.
 *
 * Not rate-limited: PlatformThrottlerGuard is not global (platform-auth.module.ts
 * registers no ThrottlerGuard; PlatformSessionController applies it per method),
 * so this controller needs no `@SkipThrottle({ platform_auth: true })` (KI-082).
 * Both routes need a valid access token and guess no credential, like `/me`
 * and `logout-all`, which are not limited either.
 */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/sessions')
@ApiUnauthorizedResponse({
  type: PlatformAuthErrorDto,
  description: 'unauthenticated | token_expired | token_invalid | session_invalid',
})
export class PlatformSessionsController {
  private readonly cookie: RefreshCookieOptions;

  constructor(
    private readonly sessions: PlatformSessionsService,
    tokens: PlatformTokenService,
    config: ConfigService<PlatformEnv, true>,
  ) {
    this.cookie = platformRefreshCookieOptions(config, tokens);
  }

  @Get()
  @ApiOperation({
    summary: 'List my active platform sessions (API-203)',
    description:
      'One item per signed-in device: every refresh-token family of the caller that still has a live refresh token (not revoked, not rotated, not expired, the family before its absolute deadline), newest activity first. ' +
      '`current` marks the session of the `pla_refresh` cookie sent with the request. Never a token or a hash. Any platform role; no audit event.',
  })
  @ApiOkResponse({ type: PlatformSessionListDto })
  @ApiForbiddenResponse({ type: PlatformAuthErrorDto, description: 'account_suspended' })
  list(@CurrentPlatformUser() caller: PlatformPrincipal, @Req() req: Request): Promise<PlatformSessionListDto> {
    return this.sessions.list(caller, readPlatformRefreshCookie(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sign out one of my platform sessions (API-204)',
    description:
      'Revokes every refresh token of the caller’s session `id` (the `id` of an item of `GET /api/auth/sessions`): that device can no longer refresh. ' +
      'Revoking the current session also clears the `pla_refresh` cookie, like logout. Access tokens already issued for that session stay valid until they expire. ' +
      'Records one `platform.auth.session.revoked` event.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The session id (refresh-token family id)' })
  @ApiNoContentResponse({ description: 'Revoked' })
  @ApiBadRequestResponse({ description: '`id` is not a UUID' })
  @ApiForbiddenResponse({ type: PlatformAuthErrorDto, description: 'origin_forbidden | account_suspended' })
  @ApiNotFoundResponse({
    type: PlatformAuthErrorDto,
    description:
      'session_not_found — not a session of the caller, or it has no live refresh token (revoked, expired or past its deadline)',
  })
  async revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentPlatformUser() caller: PlatformPrincipal,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const { current } = await this.sessions.revoke(caller, id, readPlatformRefreshCookie(req), requestContext(req));
    if (current) clearPlatformRefreshCookie(res, this.cookie);
  }
}
