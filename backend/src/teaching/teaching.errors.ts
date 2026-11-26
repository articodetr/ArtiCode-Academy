// Error vocabulary of «طلابي» (CH-0370). Same body shape as the other modules:
// `{ statusCode, error, code, message, ...details }`.
//
//   student_not_found   404 — no student with this id in a class the caller teaches
//                             (any other student answers the same, so nothing leaks)
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const TEACHING_ERROR_CODES = ['student_not_found'] as const;
export type TeachingErrorCode = (typeof TEACHING_ERROR_CODES)[number];

export class TeachingHttpException extends HttpException {
  readonly code: TeachingErrorCode;

  constructor(status: HttpStatus, code: TeachingErrorCode, message: string, details: Record<string, unknown> = {}) {
    super({ statusCode: status, error: STATUS_CODES[status] ?? 'Error', code, message, ...details }, status);
    this.code = code;
  }
}

export const teachingError = {
  studentNotFound: (studentId: string) =>
    new TeachingHttpException(HttpStatus.NOT_FOUND, 'student_not_found', 'No such student in your classes', { studentId }),
};
