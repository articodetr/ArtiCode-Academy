// Turns an issued session into the HTTP response every session-opening route
// returns (MOD-01 login/refresh, MOD-03-T03 invitation acceptance, later T05):
// the refresh token goes into the httpOnly cookie, the access token and the
// principal into the JSON body.
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Env } from '../config/env.schema.js';
import type { AuthUserDto, SessionResponseDto } from './auth.dto.js';
import type { IssuedSession } from './auth.service.js';
import { refreshCookiePath, setRefreshCookie } from './cookies.js';
import type { RefreshCookieOptions } from './cookies.js';
import type { AuthPrincipal } from './principal.js';
import type { TokenService } from './token.service.js';

/** Cookie attributes derived once per controller from the configuration. */
export function sessionCookieOptions(config: ConfigService<Env, true>, tokens: TokenService): RefreshCookieOptions {
  return {
    secure: config.get('AUTH_COOKIE_SECURE', { infer: true }),
    path: refreshCookiePath(config.get('API_PREFIX', { infer: true })),
    maxAgeMs: tokens.refreshTtlMs,
  };
}

export function toUserDto(user: AuthPrincipal): AuthUserDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    displayName: user.displayName,
    locale: user.locale,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    roles: user.roles,
    permissions: user.permissions,
  };
}

/** Sets the refresh cookie and returns the response body. */
export function presentSession(res: Response, session: IssuedSession, cookie: RefreshCookieOptions): SessionResponseDto {
  setRefreshCookie(res, session.refreshToken, cookie);
  return {
    tokenType: 'Bearer',
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
    user: toUserDto(session.user),
  };
}
