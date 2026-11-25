// PORTAL-04 — the error vocabulary of Google sign-in. Only the start route
// answers JSON errors (`503 google_unavailable`, besides the shared
// `403 origin_forbidden`, `429 rate_limited` and a validation 400); the
// callback never answers JSON — every outcome there is a 302 whose
// `/login?google=<code>` carries one of GOOGLE_FAILURE_CODES (google-state.ts).
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const GOOGLE_ERROR_CODES = ['google_unavailable'] as const;
export type GoogleErrorCode = (typeof GOOGLE_ERROR_CODES)[number];

/** HttpException whose body is `{ statusCode, error, code, message }`, like every other module. */
export class GoogleHttpException extends HttpException {
  readonly code: GoogleErrorCode;

  constructor(status: HttpStatus, code: GoogleErrorCode, message: string) {
    super({ statusCode: status, error: STATUS_CODES[status] ?? 'Error', code, message }, status);
    this.code = code;
  }
}

export const googleError = {
  unavailable: () =>
    new GoogleHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'google_unavailable',
      'Google sign-in is not configured on this server',
    ),
};
