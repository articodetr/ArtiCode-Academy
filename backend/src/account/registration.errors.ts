// Error vocabulary of student self-registration (PORTAL-03, #207 contract v2). Same shape as the other module
// dictionaries: the body is `{ statusCode, error, code, message, ...details }` and the frontend maps the stable
// `code` (`frontend/src/studentRegistration/registration.errors.ts`). The routes also answer `password_weak` and
// `rate_limited` from the MOD-01 dictionary (auth.errors.ts) and `origin_forbidden` from the OriginGuard.
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { RegistrationViolations } from './registration.rules.js';

export const REGISTRATION_ERROR_CODES = [
  'registration_invalid',
  'registration_disabled',
  'registration_link_invalid',
  'registration_link_expired',
] as const;

export type RegistrationErrorCode = (typeof REGISTRATION_ERROR_CODES)[number];

export interface RegistrationErrorBody {
  statusCode: number;
  error: string;
  code: RegistrationErrorCode;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class RegistrationHttpException extends HttpException {
  readonly code: RegistrationErrorCode;

  constructor(status: HttpStatus, code: RegistrationErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: RegistrationErrorBody = { statusCode: status, error: STATUS_CODES[status] ?? 'Error', code, message, ...details };
    super(body, status);
    this.code = code;
  }
}

export const registrationError = {
  /** 400: `fields` = the problems of each field, `unknown` = the names of the fields the route does not accept. */
  invalid: (violations: RegistrationViolations) =>
    new RegistrationHttpException(HttpStatus.BAD_REQUEST, 'registration_invalid', 'The registration request is not valid', {
      fields: violations.fields,
      unknown: violations.unknown,
    }),
  /** 403: the academy does not take registrations (`settings.selfRegistration.enabled`, or no mail transport). */
  disabled: () =>
    new RegistrationHttpException(HttpStatus.FORBIDDEN, 'registration_disabled', 'This academy does not accept self-registration'),
  /** 404: malformed, unknown, used, replaced, not a self-registration link, or the account can no longer be completed. */
  linkInvalid: () =>
    new RegistrationHttpException(HttpStatus.NOT_FOUND, 'registration_link_invalid', 'This registration link is not valid'),
  /** 410: the link ran out; the visitor registers again with the same address. */
  linkExpired: (expiresAt: Date) =>
    new RegistrationHttpException(HttpStatus.GONE, 'registration_link_expired', 'This registration link has expired', {
      expiresAt: expiresAt.toISOString(),
    }),
};
