// PORTAL-04 — the rate limits of Google sign-in (review #2).
//
//   start     200 per 15 minutes per IP on the `login` throttler — the start
//             body carries no identifier, so the IP is the only key; a school
//             behind one address signs in many learners at once.
//   callback  30 per 15 minutes per (IP, SHA-256 of the `aca_google` cookie) on
//             `login` — the digest, never the value — so every attempt has a
//             budget of its own and one replayed state cookie stops quickly;
//             plus a per-IP ceiling of 300 per 15 minutes (the named throttler
//             GOOGLE_CALLBACK_IP_THROTTLER of the guard below), so spraying
//             forged cookies from one address stops too.
//
// The key of a limit never names a body or query value. The ceiling is not a
// module-wide throttler (app.module.ts): it is added by
// GoogleCallbackThrottlerGuard, which only the callback uses, and its skipIf
// keeps it to the route marked @GoogleCallbackThrottle() even so. A refusal is
// still the callback's 302 (GoogleCallbackExceptionFilter), with
// `Retry-After-login` or `Retry-After-google_callback_ip` set by the library.
import { createHash } from 'node:crypto';
import { applyDecorators, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { normalizeIp, Throttle } from '@nestjs/throttler';
import type { ThrottlerOptions } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthThrottlerGuard } from '../auth-throttler.guard.js';
import { readGoogleStateCookie } from './google.cookie.js';

/** The window of every Google limit. */
export const GOOGLE_THROTTLE_TTL_MS = 15 * 60 * 1000;
/** Sign-in attempts per 15 minutes per IP. */
export const GOOGLE_START_LIMIT = 200;
/** Returns from Google per 15 minutes per (IP, state-cookie digest), on the `login` throttler. */
export const GOOGLE_CALLBACK_CLIENT_LIMIT = 30;
/** Name of the per-IP ceiling of the callback (added by GoogleCallbackThrottlerGuard). */
export const GOOGLE_CALLBACK_IP_THROTTLER = 'google_callback_ip';
/** Every return from Google per 15 minutes per IP, whatever the cookie. */
export const GOOGLE_CALLBACK_IP_LIMIT = 300;

const CALLBACK_ROUTE_KEY = 'articode:auth:google-callback-throttle';
// A standalone Reflector: the ceiling's skipIf runs without a guard instance.
const reflector = new Reflector();

function ipOf(req: Record<string, any>): string {
  return normalizeIp(typeof req['ip'] === 'string' ? req['ip'] : '');
}

/** Per IP only (`normalizeIp()`: an IPv6 address by its /64) — the start route and the callback's ceiling. */
export function googleIpTracker(req: Record<string, any>): string {
  return ipOf(req);
}

/**
 * The per-attempt key of the callback: the IP and the first 32 hex digits of
 * the SHA-256 of the `aca_google` cookie — never the cookie itself. Without the
 * cookie every return from that IP shares one key (such a return always fails).
 */
export function googleCallbackClientTracker(req: Record<string, any>): string {
  const cookie = readGoogleStateCookie(req as Request);
  const digest = cookie ? createHash('sha256').update(cookie).digest('hex').slice(0, 32) : 'none';
  return `${ipOf(req)}|google:${digest}`;
}

/** True on the route marked @GoogleCallbackThrottle() — GET /api/auth/google/callback only. */
export function isGoogleCallbackRoute(context: ExecutionContext): boolean {
  return reflector.get<boolean | undefined>(CALLBACK_ROUTE_KEY, context.getHandler()) === true;
}

/** The per-IP ceiling of the callback: 300 per 15 minutes; off on every route not marked @GoogleCallbackThrottle(). */
export const GOOGLE_CALLBACK_IP_THROTTLER_OPTIONS: ThrottlerOptions = {
  name: GOOGLE_CALLBACK_IP_THROTTLER,
  ttl: GOOGLE_THROTTLE_TTL_MS,
  limit: GOOGLE_CALLBACK_IP_LIMIT,
  skipIf: (context) => !isGoogleCallbackRoute(context),
  getTracker: googleIpTracker,
};

/**
 * AuthThrottlerGuard (its `login` throttler, its 429 `rate_limited`) plus the
 * callback's per-IP ceiling. Used by the callback alone, through
 * @GoogleCallbackThrottle().
 */
@Injectable()
export class GoogleCallbackThrottlerGuard extends AuthThrottlerGuard {
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    if (!this.throttlers.some((throttler) => throttler.name === GOOGLE_CALLBACK_IP_THROTTLER)) {
      this.throttlers = [...this.throttlers, GOOGLE_CALLBACK_IP_THROTTLER_OPTIONS];
    }
  }
}

/** The start route: 200 per 15 minutes per IP on `login`. */
export const GoogleStartThrottle = () =>
  applyDecorators(
    UseGuards(AuthThrottlerGuard),
    Throttle({ login: { limit: GOOGLE_START_LIMIT, ttl: GOOGLE_THROTTLE_TTL_MS, getTracker: googleIpTracker } }),
  );

/** The callback: 30 per 15 minutes per (IP, cookie digest) on `login`, and the per-IP ceiling of 300. */
export const GoogleCallbackThrottle = () =>
  applyDecorators(
    SetMetadata(CALLBACK_ROUTE_KEY, true),
    UseGuards(GoogleCallbackThrottlerGuard),
    Throttle({ login: { limit: GOOGLE_CALLBACK_CLIENT_LIMIT, ttl: GOOGLE_THROTTLE_TTL_MS, getTracker: googleCallbackClientTracker } }),
  );
