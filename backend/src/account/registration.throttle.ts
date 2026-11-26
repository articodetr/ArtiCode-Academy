// PORTAL-03 (#207): the limits of the registration routes, built like the session refresh's (D-R140,
// auth-throttler.guard.ts). `POST /api/account/register` is counted per (IP, e-mail) and the completion
// `POST /api/account/register/:token/complete` per (IP, token digest) by the `login` throttler through route-level
// trackers; a second named throttler `register_ip` — registered next to `login` in app.module.ts — is the per-IP
// ceiling of these two routes and no other (each route has its own counter: the library keys a counter by its
// handler). A refusal carries `Retry-After-login` or `Retry-After-register_ip` (the frontend reads both).
import { createHash } from 'node:crypto';
import { applyDecorators, SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { normalizeIp, Throttle } from '@nestjs/throttler';
import type { ThrottlerOptions } from '@nestjs/throttler';
import { EMAIL_MAX_LENGTH } from '../users/users.validation.js';

/** Registrations per 15 minutes per (IP, e-mail), on the `login` throttler. */
export const REGISTER_CLIENT_LIMIT = 5;
export const REGISTER_CLIENT_TTL_MS = 15 * 60 * 1000;
/** Name of the per-IP ceiling (app.module.ts). */
export const REGISTER_IP_THROTTLER = 'register_ip';
/**
 * Every registration request per hour per IP, whatever the address. Since the direct registration (PORTAL-04) each
 * request may create an active account at once — no e-mail, so no daily mail budget bounds it any more — hence 60, not
 * the 200 of the e-mailed flow (a school behind one NAT still registers a class within the hour).
 */
export const REGISTER_IP_LIMIT = 60;
export const REGISTER_IP_TTL_MS = 60 * 60 * 1000;
/** Completions per 15 minutes per (IP, token digest), on the `login` throttler. */
export const COMPLETE_CLIENT_LIMIT = 20;
export const COMPLETE_CLIENT_TTL_MS = 15 * 60 * 1000;
/** Every completion request per 15 minutes per IP, whatever the token (on `register_ip`). */
export const COMPLETE_IP_LIMIT = 200;
export const COMPLETE_IP_TTL_MS = 15 * 60 * 1000;

const REGISTER_ROUTE_KEY = 'articode:account:register-throttle';
const COMPLETE_ROUTE_KEY = 'articode:account:register-complete-throttle';
// A standalone Reflector: the ceiling's skipIf below runs without a guard instance.
const reflector = new Reflector();

/** True on the route marked @RegisterThrottle() — POST /api/account/register only. */
export function isRegisterRoute(context: ExecutionContext): boolean {
  return reflector.get<boolean | undefined>(REGISTER_ROUTE_KEY, context.getHandler()) === true;
}

/** True on the route marked @CompleteRegistrationThrottle() — POST /api/account/register/:token/complete only. */
export function isCompleteRegistrationRoute(context: ExecutionContext): boolean {
  return reflector.get<boolean | undefined>(COMPLETE_ROUTE_KEY, context.getHandler()) === true;
}

/**
 * The per-client key of a registration: the IP and the address as it will be
 * stored (trimmed, lower-cased) — read from the raw body, before validation,
 * so a malformed body from one IP shares one budget.
 */
export function registrationClientTracker(req: Record<string, any>): string {
  const ip: string = typeof req['ip'] === 'string' ? req['ip'] : '';
  const body = req['body'] as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, EMAIL_MAX_LENGTH) : '';
  return `${ip}|register:${email}`;
}

/**
 * The per-client key of a completion: the IP and the first 32 hex digits of the
 * SHA-256 of the token in the path — never the token itself (it would sit in
 * the limiter's memory as a usable link). Pupils of one school completing
 * their own links behind one NAT never share a budget; only one link guessed
 * at, or retried in a loop, reaches the limit.
 */
export function completionClientTracker(req: Record<string, any>): string {
  const ip: string = typeof req['ip'] === 'string' ? req['ip'] : '';
  const params = req['params'] as { token?: unknown } | undefined;
  const token = typeof params?.token === 'string' ? params.token.slice(0, 256) : '';
  return `${ip}|register-complete:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
}

/** Marks the registration route: 5 per 15 minutes per (IP, e-mail) on `login`, and the `register_ip` ceiling applies (60 per hour). */
export const RegisterThrottle = () =>
  applyDecorators(
    SetMetadata(REGISTER_ROUTE_KEY, true),
    Throttle({ login: { limit: REGISTER_CLIENT_LIMIT, ttl: REGISTER_CLIENT_TTL_MS, getTracker: registrationClientTracker } }),
  );

/** Marks the completion route: 20 per 15 minutes per (IP, token digest) on `login`, and 200 per 15 minutes per IP on `register_ip`. */
export const CompleteRegistrationThrottle = () =>
  applyDecorators(
    SetMetadata(COMPLETE_ROUTE_KEY, true),
    Throttle({
      login: { limit: COMPLETE_CLIENT_LIMIT, ttl: COMPLETE_CLIENT_TTL_MS, getTracker: completionClientTracker },
      [REGISTER_IP_THROTTLER]: { limit: COMPLETE_IP_LIMIT, ttl: COMPLETE_IP_TTL_MS },
    }),
  );

/**
 * The per-IP ceiling of the two registration writes: 60 registrations per
 * hour and 200 completions per 15 minutes per IP (`normalizeIp()`: an IPv6
 * address by its /64); the completion route overrides the limit and window
 * with @CompleteRegistrationThrottle(). Its `skipIf` keeps it off every route
 * not marked by one of the two decorators, so no other route is counted or
 * refused by it, whichever ThrottlerGuard runs there.
 */
export const REGISTER_IP_THROTTLER_OPTIONS: ThrottlerOptions = {
  name: REGISTER_IP_THROTTLER,
  ttl: REGISTER_IP_TTL_MS,
  limit: REGISTER_IP_LIMIT,
  skipIf: (context) => !isRegisterRoute(context) && !isCompleteRegistrationRoute(context),
  getTracker: (req) => normalizeIp(typeof req['ip'] === 'string' ? req['ip'] : ''),
};
