// Error vocabulary of MOD-13 reports (roadmap §4k.4, owner decisions
// D-R66..D-R73). One dictionary for the whole module, complete from T01 on so
// T02..T04 only use it. Same shape as the other module dictionaries: the body
// is `{ statusCode, error, code, message, ...details }` and the frontend maps
// the stable `code`. A detail is never named `code`. Validation failures stay
// the plain 400 of the ValidationPipe; a caller without the report's key gets
// the guard's (or, for the overview, the controller's) `permission_denied`.
//
//   report_range_invalid   400 — `from` after `to`, or a period longer than the limit ({ from, to, maxDays })
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const REPORTS_ERROR_CODES = ['report_range_invalid'] as const;

export type ReportsErrorCode = (typeof REPORTS_ERROR_CODES)[number];

export interface ReportsErrorBody {
  statusCode: number;
  error: string;
  code: ReportsErrorCode;
  message: string;
  [detail: string]: unknown;
}

export class ReportsHttpException extends HttpException {
  readonly code: ReportsErrorCode;

  constructor(status: HttpStatus, code: ReportsErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: ReportsErrorBody = { statusCode: status, error: STATUS_CODES[status] ?? 'Error', code, message, ...details };
    super(body, status);
    this.code = code;
  }
}

export const reportsError = {
  rangeInvalid: (from: string, to: string, maxDays: number) =>
    new ReportsHttpException(HttpStatus.BAD_REQUEST, 'report_range_invalid', `A report period starts no later than it ends and lasts at most ${maxDays} days`, { from, to, maxDays }),
};
