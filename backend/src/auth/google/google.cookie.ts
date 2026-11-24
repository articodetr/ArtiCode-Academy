// PORTAL-04 — the `aca_google` cookie: the signed state of one Google sign-in
// attempt, from `POST /api/auth/google/start` to Google's redirect back.
// httpOnly; `SameSite=Lax` because it must come back on Google's top-level
// redirect to the callback (a Strict cookie would not); `Secure` like the
// session cookie; scoped to `/<API_PREFIX>/auth/google`; 10 minutes. The
// callback clears it in every outcome (`Max-Age=0`, same path).
import { parseCookie } from 'cookie';
import type { Request, Response } from 'express';
import { GOOGLE_STATE_COOKIE, GOOGLE_STATE_TTL_SECONDS } from './google-state.js';

export interface GoogleCookieOptions {
  secure: boolean;
  /** `/<API_PREFIX>/auth/google`. */
  path: string;
}

export function googleCookiePath(apiPrefix: string): string {
  return `/${apiPrefix}/auth/google`;
}

export function readGoogleStateCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const value = parseCookie(header)[GOOGLE_STATE_COOKIE];
  return value && value.length > 0 ? value : undefined;
}

export function setGoogleStateCookie(res: Response, token: string, options: GoogleCookieOptions): void {
  res.cookie(GOOGLE_STATE_COOKIE, token, {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'lax',
    path: options.path,
    maxAge: GOOGLE_STATE_TTL_SECONDS * 1000,
  });
}

/** `aca_google=; Max-Age=0` on the same path: the attempt is over, whatever its outcome. */
export function clearGoogleStateCookie(res: Response, options: GoogleCookieOptions): void {
  res.cookie(GOOGLE_STATE_COOKIE, '', {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'lax',
    path: options.path,
    maxAge: 0,
  });
}
