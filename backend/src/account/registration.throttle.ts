// PORTAL-03 (#207): the two limits of `POST /api/account/register`, built like the session refresh's (D-R140,
// auth-throttler.guard.ts): the `login` throttler counts it per (IP, e-mail) through a route-level tracker, and a
// second named throttler `register_ip` — registered next to `login` in app.module.ts — is the per-IP ceiling of
// this one route. A refusal carries `Retry-After-login` or `Retry-After-register_ip` (the frontend reads both).
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
/** Every registration request per hour per IP, whatever the address. */
export const REGISTER_IP_LIMIT = 20;
export const REGISTER_IP_TTL_MS = 60 * 60 * 1000;

const REGISTER_ROUTE_KEY = 'articode:account:register-throttle';
// A standalone Reflector: the ceiling's skipIf below runs without a guard instance.
const reflector = new Reflector();

/** True on the route marked @RegisterThrottle() — POST /api/account/register only. */
export function isRegisterRoute(context: ExecutionContext): boolean {
  return reflector.get<boolean | undefined>(REGISTER_ROUTE_KEY, context.getHandler()) === true;
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

/** Marks the registration route: 5 per 15 minutes per (IP, e-mail) on `login`, and the `register_ip` ceiling applies. */
export const RegisterThrottle = () =>
  applyDecorators(
    SetMetadata(REGISTER_ROUTE_KEY, true),
    Throttle({ login: { limit: REGISTER_CLIENT_LIMIT, ttl: REGISTER_CLIENT_TTL_MS, getTracker: registrationClientTracker } }),
  );

/**
 * The per-IP ceiling of the registration route: 20 per hour per IP
 * (`normalizeIp()`: an IPv6 address by its /64). Its `skipIf` keeps it off
 * every route not marked @RegisterThrottle(), so no other route is counted or
 * refused by it, whichever ThrottlerGuard runs there.
 */
export const REGISTER_IP_THROTTLER_OPTIONS: ThrottlerOptions = {
  name: REGISTER_IP_THROTTLER,
  ttl: REGISTER_IP_TTL_MS,
  limit: REGISTER_IP_LIMIT,
  skipIf: (context) => !isRegisterRoute(context),
  getTracker: (req) => normalizeIp(typeof req['ip'] === 'string' ? req['ip'] : ''),
};
