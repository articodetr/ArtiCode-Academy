// Error vocabulary of the platform's authentication (MOD-18-T02; the login and
// refresh codes are used by T03; session_not_found by the sessions routes of
// MOD-01-H06, API-203/204; the mfa_* codes by PMFA, roadmap §4o — the same
// names, statuses and messages as the academy's). Same body shape as the academy API
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
  // MOD-01-H06 — the sessions routes (API-203/204)
  'session_not_found',
  // PMFA — two-step verification (roadmap §4o)
  'mfa_unavailable',
  'mfa_already_enabled',
  'mfa_not_enabled',
  'mfa_setup_required',
  'mfa_code_invalid',
  'mfa_factor_required',
  'mfa_challenge_invalid',
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
  sessionNotFound: () => authException(HttpStatus.NOT_FOUND, 'session_not_found', 'No active session with this id'),
  // PMFA — the same codes, statuses and messages as the academy's (src/auth/auth.errors.ts).
  /** No usable PLATFORM_MFA_ENCRYPTION_KEY — the MFA routes are off and an MFA account cannot sign in (never a bypass). */
  mfaUnavailable: () =>
    authException(HttpStatus.SERVICE_UNAVAILABLE, 'mfa_unavailable', 'Two-step verification is not available on this server'),
  mfaAlreadyEnabled: () => authException(HttpStatus.CONFLICT, 'mfa_already_enabled', 'Two-step verification is already on'),
  mfaNotEnabled: () => authException(HttpStatus.CONFLICT, 'mfa_not_enabled', 'Two-step verification is not on'),
  /** The confirmation without a setup younger than its lifetime. */
  mfaSetupRequired: () =>
    authException(HttpStatus.CONFLICT, 'mfa_setup_required', 'Start the setup again: no pending setup, or it expired'),
  /** A wrong or already used TOTP code or recovery code: 400 on the account routes, 401 on the sign-in step. */
  mfaCodeInvalid: (status: HttpStatus.BAD_REQUEST | HttpStatus.UNAUTHORIZED = HttpStatus.BAD_REQUEST) =>
    authException(status, 'mfa_code_invalid', 'The verification code is not valid'),
  /** Exactly one of `code` and `recoveryCode` must be sent. */
  mfaFactorRequired: () =>
    authException(HttpStatus.BAD_REQUEST, 'mfa_factor_required', 'Send exactly one of code and recoveryCode'),
  /** The sign-in step: unknown, used, expired or exhausted challenge — sign in with the password again. */
  mfaChallengeInvalid: () =>
    authException(HttpStatus.UNAUTHORIZED, 'mfa_challenge_invalid', 'The sign-in step expired or is not valid; sign in again'),
};
