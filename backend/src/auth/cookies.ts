// Refresh tokens reach browsers only through an httpOnly cookie scoped to the
// auth routes (never readable by page scripts, never in localStorage).
import { isIP } from 'node:net';
import { parseCookie } from 'cookie';
import type { Request, Response } from 'express';
import type { RequestContext } from './principal.js';

export const REFRESH_COOKIE_NAME = 'aca_refresh';

export interface RefreshCookieOptions {
  /** `Secure` attribute (true in production). */
  secure: boolean;
  /** Cookie path: `/<API_PREFIX>/auth` so it is sent to the auth routes only. */
  path: string;
  /** Lifetime in milliseconds. */
  maxAgeMs: number;
}

export function refreshCookiePath(apiPrefix: string): string {
  return `/${apiPrefix}/auth`;
}

export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const value = parseCookie(header)[REFRESH_COOKIE_NAME];
  return value && value.length > 0 ? value : undefined;
}

export function setRefreshCookie(res: Response, token: string, options: RefreshCookieOptions): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'strict',
    path: options.path,
    maxAge: options.maxAgeMs,
  });
}

export function clearRefreshCookie(res: Response, options: Pick<RefreshCookieOptions, 'secure' | 'path'>): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'strict',
    path: options.path,
  });
}

const MAX_USER_AGENT = 512;

/** IP and user agent of the caller, sanitised for the `inet`/`text` audit columns. */
export function requestContext(req: Request): RequestContext {
  const rawIp = req.ip ?? req.socket?.remoteAddress ?? '';
  const ip = isIP(rawIp) ? rawIp : null;
  const header = req.headers['user-agent'];
  const userAgent = typeof header === 'string' && header.length > 0 ? header.slice(0, MAX_USER_AGENT) : null;
  return { ip, userAgent };
}

/** `Authorization: Bearer <token>` → token, or undefined. */
export function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token.trim() : undefined;
}
