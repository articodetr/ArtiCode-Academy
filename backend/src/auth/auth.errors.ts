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
  // MOD-01-H06: DELETE /api/auth/sessions/:id (API-202) on a session that is not the caller's or has no live token.
  'session_not_found',
  // MOD-01-H06 — MFA / TOTP (roadmap §4n, D-R107..D-R110).
  'mfa_unavailable',
  'mfa_already_enabled',
  'mfa_not_enabled',
  'mfa_setup_required',
  'mfa_code_invalid',
  'mfa_factor_required',
  'mfa_challenge_invalid',
  // PORTAL-04 (#207, contract v3): a self-registered account whose holder has not confirmed the address yet,
  // answered only after its password matched.
  'email_not_verified',
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
  /**
   * PORTAL-04 (contract v3): the password of a self-registered account matched, but its holder has not opened the
   * e-mailed confirmation link yet (it activates the account with this same password).
   */
  emailNotVerified: () =>
    new AuthHttpException(
      HttpStatus.FORBIDDEN,
      'email_not_verified',
      'Confirm your e-mail address first: open the link we sent and enter your password',
    ),
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
  sessionNotFound: () =>
    new AuthHttpException(HttpStatus.NOT_FOUND, 'session_not_found', 'No active session with this id'),
  /** D-R107: no usable `AUTH_MFA_ENCRYPTION_KEY` — the MFA routes are off and an MFA account cannot sign in (never a bypass). */
  mfaUnavailable: () =>
    new AuthHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'mfa_unavailable',
      'Two-step verification is not available on this server',
    ),
  mfaAlreadyEnabled: () =>
    new AuthHttpException(HttpStatus.CONFLICT, 'mfa_already_enabled', 'Two-step verification is already on'),
  mfaNotEnabled: () =>
    new AuthHttpException(HttpStatus.CONFLICT, 'mfa_not_enabled', 'Two-step verification is not on'),
  /** API-208 without a setup (API-207) younger than its lifetime. */
  mfaSetupRequired: () =>
    new AuthHttpException(
      HttpStatus.CONFLICT,
      'mfa_setup_required',
      'Start the setup again: no pending setup, or it expired',
    ),
  /** A wrong or already used TOTP code or recovery code: 400 on the account routes, 401 on the sign-in step. */
  mfaCodeInvalid: (status: HttpStatus.BAD_REQUEST | HttpStatus.UNAUTHORIZED = HttpStatus.BAD_REQUEST) =>
    new AuthHttpException(status, 'mfa_code_invalid', 'The verification code is not valid'),
  /** Exactly one of `code` and `recoveryCode` must be sent. */
  mfaFactorRequired: () =>
    new AuthHttpException(
      HttpStatus.BAD_REQUEST,
      'mfa_factor_required',
      'Send exactly one of code and recoveryCode',
    ),
  /** API-211: unknown, used, expired or exhausted challenge — sign in with the password again. */
  mfaChallengeInvalid: () =>
    new AuthHttpException(
      HttpStatus.UNAUTHORIZED,
      'mfa_challenge_invalid',
      'The sign-in step expired or is not valid; sign in again',
    ),
};
