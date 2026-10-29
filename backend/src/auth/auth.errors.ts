// Error vocabulary of MOD-01. Every failure carries a stable `code` the
// frontend maps to a localized message; `message` is for developers.
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const AUTH_ERROR_CODES = [
  'invalid_credentials',
  'account_not_activated',
  'account_pending',
  'account_suspended',
  'account_locked',
  'unauthenticated',
  'token_expired',
  'token_invalid',
  'session_invalid',
  'permission_denied',
  'refresh_missing',
  'refresh_invalid',
  'refresh_expired',
  'refresh_reused',
  'password_invalid',
  'password_weak',
  'rate_limited',
  'origin_forbidden',
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export interface AuthErrorBody {
  statusCode: number;
  error: string;
  code: AuthErrorCode;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class AuthHttpException extends HttpException {
  readonly code: AuthErrorCode;

  constructor(
    status: HttpStatus,
    code: AuthErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    const body: AuthErrorBody = {
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      code,
      message,
      ...details,
    };
    super(body, status);
    this.code = code;
  }
}

const LOCKED = 423 as HttpStatus;

export const authError = {
  invalidCredentials: () =>
    new AuthHttpException(HttpStatus.UNAUTHORIZED, 'invalid_credentials', 'Invalid identifier or password'),
  accountNotActivated: () =>
    new AuthHttpException(
      HttpStatus.FORBIDDEN,
      'account_not_activated',
      'This account has not been activated yet',
    ),
  accountPending: () =>
    new AuthHttpException(HttpStatus.FORBIDDEN, 'account_pending', 'This account is awaiting approval'),
  accountSuspended: () =>
    new AuthHttpException(HttpStatus.FORBIDDEN, 'account_suspended', 'This account is suspended'),
  accountLocked: (retryAfterSeconds: number) =>
    new AuthHttpException(LOCKED, 'account_locked', 'Too many failed attempts; the account is temporarily locked', {
      retryAfterSeconds,
    }),
  unauthenticated: () =>
    new AuthHttpException(HttpStatus.UNAUTHORIZED, 'unauthenticated', 'Authentication required'),
  tokenExpired: () =>
    new AuthHttpException(HttpStatus.UNAUTHORIZED, 'token_expired', 'Access token expired'),
  tokenInvalid: () =>
    new AuthHttpException(HttpStatus.UNAUTHORIZED, 'token_invalid', 'Access token is not valid'),
  sessionInvalid: () =>
    new AuthHttpException(HttpStatus.UNAUTHORIZED, 'session_invalid', 'Session is no longer valid'),
  permissionDenied: (missing: readonly string[]) =>
    new AuthHttpException(HttpStatus.FORBIDDEN, 'permission_denied', 'Missing permission', {
      missing: [...missing],
    }),
  refreshMissing: () =>
    new AuthHttpException(HttpStatus.UNAUTHORIZED, 'refresh_missing', 'No refresh token'),
  refreshInvalid: () =>
    new AuthHttpException(HttpStatus.UNAUTHORIZED, 'refresh_invalid', 'Refresh token is not valid'),
  refreshExpired: () =>
    new AuthHttpException(HttpStatus.UNAUTHORIZED, 'refresh_expired', 'Refresh token expired'),
  refreshReused: () =>
    new AuthHttpException(
      HttpStatus.UNAUTHORIZED,
      'refresh_reused',
      'Refresh token reuse detected; all sessions of this login were revoked',
    ),
  passwordInvalid: () =>
    new AuthHttpException(HttpStatus.BAD_REQUEST, 'password_invalid', 'Current password is incorrect'),
  passwordWeak: (problems: readonly string[]) =>
    new AuthHttpException(HttpStatus.BAD_REQUEST, 'password_weak', 'New password does not meet the policy', {
      problems: [...problems],
    }),
  rateLimited: () =>
    new AuthHttpException(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', 'Too many requests; try again later'),
  originForbidden: () =>
    new AuthHttpException(
      HttpStatus.FORBIDDEN,
      'origin_forbidden',
      'The request origin is not allowed to perform state-changing requests',
    ),
};
