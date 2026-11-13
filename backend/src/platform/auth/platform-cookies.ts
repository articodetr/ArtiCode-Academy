// MOD-18-T03 (D-R100) — the platform refresh cookie. The academy pattern
// (src/auth/cookies.ts: httpOnly, SameSite=Strict, Path=/<prefix>/auth, never
// readable by page scripts) under ANOTHER name: on a developer machine the
// academy API (:3000) and the platform API (:3100) both run on localhost, and
// cookies are not isolated by port — so the platform reads only `pla_refresh`
// and never sees an academy `aca_refresh`, and the academy never reads this one.
import type { ConfigService } from '@nestjs/config';
import { parseCookie } from 'cookie';
import type { Request, Response } from 'express';
import { refreshCookiePath } from '../../auth/cookies.js';
import type { RefreshCookieOptions } from '../../auth/cookies.js';
import type { PlatformEnv } from '../platform.env.schema.js';
import type { PlatformSessionResponseDto, PlatformUserDto } from './platform-session.dto.js';
import type { PlatformTokenService } from './platform-token.service.js';

export const PLATFORM_REFRESH_COOKIE_NAME = 'pla_refresh';

/** Cookie attributes derived once per controller from the platform configuration. */
export function platformRefreshCookieOptions(
  config: ConfigService<PlatformEnv, true>,
  tokens: Pick<PlatformTokenService, 'refreshTtlMs'>,
): RefreshCookieOptions {
  return {
    secure: config.get('PLATFORM_COOKIE_SECURE', { infer: true }),
    path: refreshCookiePath(config.get('API_PREFIX', { infer: true })),
    maxAgeMs: tokens.refreshTtlMs,
  };
}

/** The `pla_refresh` value of the request, or undefined (an academy `aca_refresh` is ignored). */
export function readPlatformRefreshCookie(req: Pick<Request, 'headers'>): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const value = parseCookie(header)[PLATFORM_REFRESH_COOKIE_NAME];
  return value && value.length > 0 ? value : undefined;
}

export function setPlatformRefreshCookie(res: Response, token: string, options: RefreshCookieOptions): void {
  res.cookie(PLATFORM_REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'strict',
    path: options.path,
    maxAge: options.maxAgeMs,
  });
}

export function clearPlatformRefreshCookie(res: Response, options: Pick<RefreshCookieOptions, 'secure' | 'path'>): void {
  res.clearCookie(PLATFORM_REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'strict',
    path: options.path,
  });
}

/** An opened or rotated platform session, before it becomes the HTTP response. */
export interface IssuedPlatformSession {
  accessToken: string;
  expiresIn: number;
  /** The opaque refresh token for the cookie — never in a body, never stored. */
  refreshToken: string;
  /** Expiry of `refreshToken` (never past the family's deadline); the cookie lives as long. */
  refreshExpiresAt: Date;
  user: PlatformUserDto;
}

/**
 * Sets the refresh cookie and returns the body of API-178/179. The cookie
 * lives as long as its token: the full lifetime, or less near the family's
 * deadline (the academy MOD-01-H03 rule of presentSession()).
 */
export function presentPlatformSession(
  res: Response,
  session: IssuedPlatformSession,
  cookie: RefreshCookieOptions,
): PlatformSessionResponseDto {
  const remainingMs = Math.max(0, session.refreshExpiresAt.getTime() - Date.now());
  setPlatformRefreshCookie(res, session.refreshToken, { ...cookie, maxAgeMs: Math.min(cookie.maxAgeMs, remainingMs) });
  return {
    tokenType: 'Bearer',
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
    user: session.user,
  };
}
