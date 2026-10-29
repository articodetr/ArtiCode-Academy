// MOD-01-H02 — Origin / Fetch Metadata check for state-changing requests.
//
// A browser attaches the victim's cookies to cross-site requests, so the refresh
// cookie routes (`refresh`, `logout`) and login (login CSRF) must not be reachable
// from a page the academy does not control. `SameSite=Strict`, CORS preflights
// and JSON-only bodies (ADR-026) already cover foreign sites; this guard is the
// second layer: it reads the `Origin` header browsers send with every
// non-GET request and, when absent, the `Sec-Fetch-Site` Fetch Metadata header.
// It also closes the one hole the first layer leaves open — a compromised
// sibling subdomain of the deployment site (same-site, no preflight, cookies
// sent) — because a sibling origin is simply not on the allowlist.
//
// Decision (unsafe methods only — POST/PUT/PATCH/DELETE):
//   Origin present  → allowed iff it is on the CORS_ORIGIN allowlist, equals the
//                     request's own origin (same-origin clients such as the
//                     Swagger UI), or — outside production only — is a loopback
//                     origin (any local dev server port, e.g. Vite on :5174).
//                     `Origin: null` and malformed values are rejected.
//   Origin absent   → rejected when Sec-Fetch-Site says `cross-site` or
//                     `same-site`; otherwise allowed. Browsers always send
//                     Origin on non-GET requests, so a request without it comes
//                     from a non-browser client (curl, tests, a mobile app, a
//                     server) that carries no ambient cookies and cannot be a
//                     CSRF vector.
// Safe methods (GET/HEAD/OPTIONS) are never blocked: reads carry no CSRF risk
// and the CORS preflight must keep working.
import { Injectable, Logger } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../config/env.schema.js';
import { authError } from './auth.errors.js';

/** Methods that may change state and therefore need an acceptable origin. */
export const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface OriginCheckInput {
  method: string;
  /** Raw `Origin` header (undefined when absent). */
  origin: string | undefined;
  /** Raw `Sec-Fetch-Site` header (undefined when absent). */
  secFetchSite: string | undefined;
  /** Raw `Host` header of the request. */
  host: string | undefined;
  /** Scheme the request arrived with (`req.protocol`; honours X-Forwarded-Proto only behind `trust proxy`). */
  protocol: string;
  /** Normalised allowlist (see normalizeOrigin). */
  allowedOrigins: ReadonlySet<string>;
  /** Accept any loopback origin (development and test only). */
  allowLoopback: boolean;
}

export type OriginVerdict =
  | { allowed: true; reason: 'safe_method' | 'allowlisted' | 'same_origin' | 'loopback' | 'no_origin' }
  | { allowed: false; reason: 'origin_invalid' | 'origin_not_allowed' | 'fetch_site_rejected' };

/**
 * `https://App.Example:443` → `https://app.example`; returns null for `null`,
 * non-http(s) schemes and anything that is not a parsable origin.
 */
export function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === 'null') return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // An origin has no path, query or fragment; `URL` accepts them, we do not.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    return null;
  }
  return url.origin;
}

export function isLoopbackOrigin(normalizedOrigin: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(normalizedOrigin).hostname);
  } catch {
    return false;
  }
}

/** Pure decision used by the guard (unit-tested in origin.guard.spec.ts). */
export function evaluateOrigin(input: OriginCheckInput): OriginVerdict {
  if (!UNSAFE_METHODS.has(input.method.toUpperCase())) return { allowed: true, reason: 'safe_method' };

  if (input.origin !== undefined) {
    const origin = normalizeOrigin(input.origin);
    if (!origin) return { allowed: false, reason: 'origin_invalid' };
    if (input.allowedOrigins.has(origin)) return { allowed: true, reason: 'allowlisted' };
    const own = input.host ? normalizeOrigin(`${input.protocol}://${input.host}`) : null;
    if (own && own === origin) return { allowed: true, reason: 'same_origin' };
    if (input.allowLoopback && isLoopbackOrigin(origin)) return { allowed: true, reason: 'loopback' };
    return { allowed: false, reason: 'origin_not_allowed' };
  }

  const site = input.secFetchSite?.trim().toLowerCase();
  if (site === 'cross-site' || site === 'same-site') return { allowed: false, reason: 'fetch_site_rejected' };
  return { allowed: true, reason: 'no_origin' };
}

/** First header value, when a header is repeated. */
function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Global guard registered before AuthGuard (auth.module.ts): a rejected origin
 * answers `403 origin_forbidden` before authentication, throttling or any
 * handler runs. The allowlist is CORS_ORIGIN — one list for both mechanisms.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly logger = new Logger(OriginGuard.name);
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly allowLoopback: boolean;

  constructor(config: ConfigService<Env, true>) {
    const configured = config.get('CORS_ORIGIN', { infer: true });
    this.allowedOrigins = new Set(
      configured.map((entry) => normalizeOrigin(entry) ?? entry.trim().toLowerCase()),
    );
    this.allowLoopback = config.get('NODE_ENV', { infer: true }) !== 'production';
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const verdict = evaluateOrigin({
      method: request.method,
      origin: headerValue(request.headers.origin),
      secFetchSite: headerValue(request.headers['sec-fetch-site']),
      host: headerValue(request.headers.host),
      protocol: request.protocol,
      allowedOrigins: this.allowedOrigins,
      allowLoopback: this.allowLoopback,
    });
    if (verdict.allowed) return true;

    // Headers only — never the body (it may hold credentials).
    this.logger.warn(
      `rejected ${request.method} ${request.originalUrl ?? request.url}: ${verdict.reason} ` +
        `(origin=${JSON.stringify(headerValue(request.headers.origin) ?? null)}, ` +
        `sec-fetch-site=${JSON.stringify(headerValue(request.headers['sec-fetch-site']) ?? null)})`,
    );
    throw authError.originForbidden();
  }
}
