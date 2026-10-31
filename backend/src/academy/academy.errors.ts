// Error vocabulary of MOD-02/MOD-14 (academy identity and settings). Same
// shape as AuthHttpException / UsersHttpException: the body is
// `{ statusCode, error, code, message, ...details }` and the frontend maps the
// stable `code` to a localized message.
//
//   academy_not_configured  503  — the single `academy` row is missing (the
//                                  database was never seeded); an operator
//                                  action (`npm run prisma:seed`), not a client
//                                  one, so 503 like the readiness probe rather
//                                  than a 409 the client could resolve.
//   nothing_to_update       400  — PATCH body without any field (same code and
//                                  meaning as API-018/API-025).
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const ACADEMY_ERROR_CODES = ['academy_not_configured', 'nothing_to_update'] as const;

export type AcademyErrorCode = (typeof ACADEMY_ERROR_CODES)[number];

export interface AcademyErrorBody {
  statusCode: number;
  error: string;
  code: AcademyErrorCode;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class AcademyHttpException extends HttpException {
  readonly code: AcademyErrorCode;

  constructor(status: HttpStatus, code: AcademyErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: AcademyErrorBody = {
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

export const academyError = {
  notConfigured: () =>
    new AcademyHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'academy_not_configured',
      'This database holds no academy row yet; run the seed (npm run prisma:seed) before using the API',
    ),
  nothingToUpdate: () =>
    new AcademyHttpException(HttpStatus.BAD_REQUEST, 'nothing_to_update', 'The request body contains no field to update'),
};
