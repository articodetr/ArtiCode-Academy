import { createHash } from 'node:crypto';
import { applyDecorators, Injectable, SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { normalizeIp, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerOptions, ThrottlerRequest } from '@nestjs/throttler';
import type { Request } from 'express';
import { authError } from './auth.errors.js';
import { readRefreshCookie } from './cookies.js';

/** D-R140 (KI-098): the window of both limits of the session refresh (API-006). */
export const REFRESH_TTL_MS = 60 * 1000;
/** Refreshes per minute per (IP, presented refresh cookie), on the `login` throttler. */
export const REFRESH_CLIENT_LIMIT = 30;
/** Name of the second named throttler (app.module.ts): the per-IP ceiling of the session refresh. */
export const REFRESH_IP_THROTTLER = 'refresh_ip';
/** Every refresh request per minute per IP, with or without a cookie (20 per second). */
export const REFRESH_IP_LIMIT = 1200;

const REFRESH_ROUTE_KEY = 'articode:auth:refresh-throttle';
// A standalone Reflector: the ceiling's skipIf below runs without the guard instance.
const reflector = new Reflector();

/** True on the route marked @RefreshThrottle() — POST /api/auth/refresh only. */
export function isRefreshRoute(context: ExecutionContext): boolean {
  return reflector.get<boolean | undefined>(REFRESH_ROUTE_KEY, context.getHandler()) === true;
}

/**
 * The per-client key of a refresh (D-R140): the IP and the first 32 hex digits
 * of the SHA-256 of the presented `aca_refresh` cookie — never the cookie
 * itself. The token is rotated on every successful refresh, so a legitimate
 * client presents a new value (and gets a new budget) each time; only a client
 * looping on one token reaches the limit, and it never spends anyone else's.
 */
export function refreshClientTracker(req: Record<string, any>): string {
  const ip: string = typeof req['ip'] === 'string' ? req['ip'] : '';
  const cookie = readRefreshCookie(req as Request);
  // Not reached without a cookie (AuthThrottlerGuard.handleRequest skips the per-client limit then).
  if (!cookie) return `${ip}|refresh:none`;
  return `${ip}|refresh:${createHash('sha256').update(cookie).digest('hex').slice(0, 32)}`;
}

/**
 * Marks the session refresh (API-006): `login` counts it per (IP, cookie
 * digest) at REFRESH_CLIENT_LIMIT per minute, and the per-IP ceiling
 * REFRESH_IP_THROTTLER applies to this route and no other.
 */
export const RefreshThrottle = () =>
  applyDecorators(
    SetMetadata(REFRESH_ROUTE_KEY, true),
    Throttle({ login: { limit: REFRESH_CLIENT_LIMIT, ttl: REFRESH_TTL_MS, getTracker: refreshClientTracker } }),
  );

/**
 * The per-IP ceiling of the session refresh (D-R140), registered next to
 * `login` in app.module.ts. Its scope lives on the definition itself, not in a
 * guard: `skipIf` keeps it off every route that is not marked
 * @RefreshThrottle(), so whichever ThrottlerGuard runs (AuthThrottlerGuard on
 * the login, MFA, account, public academy and certificate-verification routes)
 * never counts or answers anything else with it — no `@SkipThrottle` to
 * remember on a new route. It counts EVERY refresh — with a cookie, without
 * one, or with a forged one — per IP (`normalizeIp()`: an IPv4 or IPv4-mapped
 * address as is, an IPv6 address by its /64, which one client can rotate
 * freely), so spraying random cookies from one address stops at 20 per
 * second. A refusal carries `Retry-After-refresh_ip` (the per-client one
 * `Retry-After-login`).
 */
export const REFRESH_IP_THROTTLER_OPTIONS: ThrottlerOptions = {
  name: REFRESH_IP_THROTTLER,
  ttl: REFRESH_TTL_MS,
  limit: REFRESH_IP_LIMIT,
  skipIf: (context) => !isRefreshRoute(context),
  getTracker: (req) => normalizeIp(typeof req['ip'] === 'string' ? req['ip'] : ''),
};

/**
 * Rate limiting for the auth routes. Login attempts are tracked per
 * (IP, identifier) so one guessed account cannot lock out a whole office,
 * while the account lock in AuthService caps attempts per account globally.
 * The second step of a two-step sign-in (API-211) carries no identifier: it is
 * tracked per (IP, challenge) — a challenge already allows 5 wrong codes and
 * counts in the account lockout, and staff signing in together behind one
 * school NAT never share a budget (MOD-01-H06). A signed-in caller without
 * either (the MFA account routes, the password change) is tracked per
 * (IP, user). Everything else per IP. The session refresh (API-006,
 * @RefreshThrottle()) is tracked per (IP, cookie digest) by its own route-level
 * tracker, a refresh without the cookie is not counted per client at all, and
 * every refresh also counts in the per-IP ceiling REFRESH_IP_THROTTLER
 * (D-R140, KI-098). In-memory storage: per process (documented limitation).
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  /**
   * D-R140: a refresh without the `aca_refresh` cookie is answered
   * `401 refresh_missing` before any database lookup, so it is never counted
   * per client — anonymous visitors loading the app behind one school NAT
   * would otherwise share one budget. Only the per-IP ceiling counts it.
   * Every other route and throttler goes through the library unchanged.
   */
  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, throttler } = requestProps;
    if (throttler.name !== REFRESH_IP_THROTTLER && isRefreshRoute(context)) {
      const { req } = this.getRequestResponse(context);
      if (!readRefreshCookie(req as Request)) return true;
    }
    return super.handleRequest(requestProps);
  }

  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const ip: string = typeof req['ip'] === 'string' ? req['ip'] : '';
    const body = req['body'] as { identifier?: unknown; challenge?: unknown } | undefined;
    const identifier =
      typeof body?.identifier === 'string' ? body.identifier.trim().toLowerCase().slice(0, 320) : '';
    if (identifier) return `${ip}|${identifier}`;
    // Only a digest of the challenge is kept as the key (never the challenge itself).
    const challenge = typeof body?.challenge === 'string' ? body.challenge.slice(0, 256) : '';
    if (challenge) return `${ip}|challenge:${createHash('sha256').update(challenge).digest('hex').slice(0, 32)}`;
    const userId = (req['user'] as { id?: unknown } | undefined)?.id;
    if (typeof userId === 'string' && userId) return `${ip}|user:${userId}`;
    return ip;
  }

  protected override async throwThrottlingException(): Promise<void> {
    throw authError.rateLimited();
  }
}
