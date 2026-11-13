// Error vocabulary of the platform's authentication (MOD-18-T02; the login and
// refresh codes are used by T03). Same body shape as the academy API
// (src/auth/auth.errors.ts): `{ statusCode, error, code, message, ...details }`
// with a stable `code` the Super Admin frontend maps to a message.
//
// PlatformHttpException is generic over its code list, so the other platform
// modules (registry T04, fleet T05) keep one dictionary each
// (`src/platform/<module>/<module>.errors.ts`) with the same body shape:
//
//   export const REGISTRY_ERROR_CODES = ['academy_not_found', …] as const;
//   type RegistryErrorCode = (typeof REGISTRY_ERROR_CODES)[number];
//   new PlatformHttpException<RegistryErrorCode>(HttpStatus.NOT_FOUND, 'academy_not_found', '…');
//
// `403 origin_forbidden` comes from the shared OriginGuard (AuthHttpException,
// the same body shape).
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const PLATFORM_AUTH_ERROR_CODES = [
  // T02 — the guards
  'unauthenticated',
  'token_expired',
  'token_invalid',
  'session_invalid',
  'account_suspended',
  'account_locked',
  'role_forbidden',
  // T03 — the session routes
  'invalid_credentials',
  'refresh_missing',
  'refresh_invalid',
  'refresh_expired',
  'refresh_reused',
  'password_invalid',
  'password_weak',
  'rate_limited',
] as const;

export type PlatformAuthErrorCode = (typeof PLATFORM_AUTH_ERROR_CODES)[number];

export interface PlatformErrorBody<C extends string = string> {
  statusCode: number;
  error: string;
  code: C;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class PlatformHttpException<C extends string = PlatformAuthErrorCode> extends HttpException {
  readonly code: C;

  constructor(status: HttpStatus, code: C, message: string, details: Record<string, unknown> = {}) {
    const body: PlatformErrorBody<C> = {
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      code,
      message,
      ...details,
    };
    super(body, status);
    this.code = code;
    this.name = 'PlatformHttpException';
  }
}

/** True for any platform error, whatever its dictionary (`code` narrows it). */
export function isPlatformHttpException(error: unknown): error is PlatformHttpException<string> {
  return error instanceof PlatformHttpException;
}

const LOCKED = 423 as HttpStatus;

function authException(status: HttpStatus, code: PlatformAuthErrorCode, message: string, details?: Record<string, unknown>) {
  return new PlatformHttpException<PlatformAuthErrorCode>(status, code, message, details);
}

export const platformAuthError = {
  unauthenticated: () => authException(HttpStatus.UNAUTHORIZED, 'unauthenticated', 'Authentication required'),
  tokenExpired: () => authException(HttpStatus.UNAUTHORIZED, 'token_expired', 'Access token expired'),
  tokenInvalid: () => authException(HttpStatus.UNAUTHORIZED, 'token_invalid', 'Access token is not valid'),
  sessionInvalid: () => authException(HttpStatus.UNAUTHORIZED, 'session_invalid', 'Session is no longer valid'),
  accountSuspended: () => authException(HttpStatus.FORBIDDEN, 'account_suspended', 'This platform account is suspended'),
  accountLocked: (retryAfterSeconds: number) =>
    authException(LOCKED, 'account_locked', 'Too many failed attempts; the account is temporarily locked', {
      retryAfterSeconds,
    }),
  roleForbidden: (required: readonly string[]) =>
    authException(HttpStatus.FORBIDDEN, 'role_forbidden', 'Your platform role may not do this', {
      required: [...required],
    }),
  invalidCredentials: () => authException(HttpStatus.UNAUTHORIZED, 'invalid_credentials', 'Invalid e-mail or password'),
  refreshMissing: () => authException(HttpStatus.UNAUTHORIZED, 'refresh_missing', 'No refresh token'),
  refreshInvalid: () => authException(HttpStatus.UNAUTHORIZED, 'refresh_invalid', 'Refresh token is not valid'),
  refreshExpired: () => authException(HttpStatus.UNAUTHORIZED, 'refresh_expired', 'Refresh token expired'),
  refreshReused: () =>
    authException(
      HttpStatus.UNAUTHORIZED,
      'refresh_reused',
      'Refresh token reuse detected; all sessions of this login were revoked',
    ),
  passwordInvalid: () => authException(HttpStatus.BAD_REQUEST, 'password_invalid', 'Current password is incorrect'),
  passwordWeak: (problems: readonly string[]) =>
    authException(HttpStatus.BAD_REQUEST, 'password_weak', 'New password does not meet the policy', {
      problems: [...problems],
    }),
  rateLimited: () => authException(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', 'Too many requests; try again later'),
};
