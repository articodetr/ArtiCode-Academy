// Error vocabulary of MOD-19 — the course catalog, self-enrollment and the
// enrollment requests (roadmap §4p, decisions D-R121..D-R129). Same shape as
// ClassesHttpException: the body is `{ statusCode, error, code, message,
// ...details }` and the frontend maps the stable `code` to a localized
// message. A detail is never named `code` — it would overwrite the error code.
// The MOD-05 codes a catalog write can also answer (class_not_found,
// not_a_student, already_enrolled, class_not_enrollable, class_full,
// enrollment_not_found, invalid_transition) stay in classes.errors.ts.
//
//   course_not_found           404  — no published course with this id: the catalog shows published
//                                      courses only, whatever the caller's other keys (D-R129) ({ courseId })
//   request_pending            409  — the caller (or the student) already has a pending request in this
//                                      class ({ enrollmentId })
//   course_price_unavailable   409  — the course is paid but its fee plan is inactive or no longer fits
//                                      the course: no request can be priced (D-R122) ({ courseId, feePlanId })
//   payment_required           409  — approving (or reactivating a never-activated row of a paid course)
//                                      needs every issued invoice of the enrollment paid in full (D-R125)
//                                      ({ enrollmentId, paymentState, invoices: [{ id, number, balance }] })
//   request_has_payments       409  — a request with a completed payment cannot be rejected or cancelled;
//                                      reverse the payments first (API-154) (D-R126) ({ enrollmentId, paymentCount })
//   rejection_reason_required  400  — `reject` needs a reason of 1..500 characters (D-R126)
//   request_not_found          404  — no request with this id that the caller may see: a request is an
//                                      enrollment with a `requested_at` (D-R121) ({ enrollmentId })
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const CATALOG_ERROR_CODES = [
  'course_not_found',
  'request_pending',
  'course_price_unavailable',
  'payment_required',
  'request_has_payments',
  'rejection_reason_required',
  'request_not_found',
] as const;

export type CatalogErrorCode = (typeof CATALOG_ERROR_CODES)[number];

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class CatalogHttpException extends HttpException {
  readonly code: CatalogErrorCode;

  constructor(status: HttpStatus, code: CatalogErrorCode, message: string, details: Record<string, unknown> = {}) {
    super({ statusCode: status, error: STATUS_CODES[status] ?? 'Error', code, message, ...details }, status);
    this.code = code;
  }
}

export interface UnpaidInvoice {
  id: string;
  number: string | null;
  balance: number;
}

export const catalogError = {
  courseNotFound: (courseId: string) =>
    new CatalogHttpException(HttpStatus.NOT_FOUND, 'course_not_found', 'No published course with this id', { courseId }),
  requestPending: (enrollmentId: string) =>
    new CatalogHttpException(HttpStatus.CONFLICT, 'request_pending', 'An enrollment request for this class is already pending', { enrollmentId }),
  coursePriceUnavailable: (courseId: string, feePlanId: string) =>
    new CatalogHttpException(HttpStatus.CONFLICT, 'course_price_unavailable', 'The fee plan of this paid course is inactive or does not fit it', {
      courseId,
      feePlanId,
    }),
  paymentRequired: (enrollmentId: string, paymentState: string, invoices: readonly UnpaidInvoice[]) =>
    new CatalogHttpException(HttpStatus.CONFLICT, 'payment_required', 'Every issued invoice of the enrollment must be paid in full first', {
      enrollmentId,
      paymentState,
      invoices: [...invoices],
    }),
  requestHasPayments: (enrollmentId: string, paymentCount: number) =>
    new CatalogHttpException(HttpStatus.CONFLICT, 'request_has_payments', 'The request has completed payments; reverse them first', {
      enrollmentId,
      paymentCount,
    }),
  rejectionReasonRequired: () =>
    new CatalogHttpException(HttpStatus.BAD_REQUEST, 'rejection_reason_required', 'A rejection needs a reason of 1 to 500 characters'),
  requestNotFound: (enrollmentId: string) =>
    new CatalogHttpException(HttpStatus.NOT_FOUND, 'request_not_found', 'No enrollment request with this id', { enrollmentId }),
};
