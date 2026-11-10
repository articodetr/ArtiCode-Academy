// Error vocabulary of MOD-10 certificates (roadmap §4h.10.4, owner decisions
// D-R50..D-R57). One dictionary for the whole module, complete from T02 on so
// T03/T04 only use it. Same shape as GradesHttpException: the body is
// `{ statusCode, error, code, message, ...details }` and the frontend maps the
// stable `code` to a localized message. A detail is never named `code`.
//
//   class_not_found               404 — no class with this id
//   class_not_completed           409 — certificates are issued for a completed class
//                                       only ({ classId, status })
//   certificate_request_invalid   400 — enrollmentIds name an enrollment of another
//                                       class or one twice ({ unknown, duplicates })
//   certificate_not_found         404 — no certificate with this id (or, for the public
//                                       verification, no certificate with this code —
//                                       a malformed code reads the same)
//   certificate_revoked           409 — the certificate is already revoked
//                                       ({ certificateId, revokedAt })
//   cursor_invalid                400 — the list cursor does not belong to this order
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const CERTIFICATES_ERROR_CODES = [
  'class_not_found',
  'class_not_completed',
  'certificate_request_invalid',
  'certificate_not_found',
  'certificate_revoked',
  'cursor_invalid',
] as const;

export type CertificatesErrorCode = (typeof CERTIFICATES_ERROR_CODES)[number];

export interface CertificatesErrorBody {
  statusCode: number;
  error: string;
  code: CertificatesErrorCode;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class CertificatesHttpException extends HttpException {
  readonly code: CertificatesErrorCode;

  constructor(status: HttpStatus, code: CertificatesErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: CertificatesErrorBody = { statusCode: status, error: STATUS_CODES[status] ?? 'Error', code, message, ...details };
    super(body, status);
    this.code = code;
  }
}

export const certificatesError = {
  classNotFound: (classId: string) => new CertificatesHttpException(HttpStatus.NOT_FOUND, 'class_not_found', 'No class with this id', { classId }),
  classNotCompleted: (classId: string, status: string) =>
    new CertificatesHttpException(HttpStatus.CONFLICT, 'class_not_completed', 'Certificates are issued for a completed class only', { classId, status }),
  requestInvalid: (unknown: readonly string[], duplicates: readonly string[]) =>
    new CertificatesHttpException(HttpStatus.BAD_REQUEST, 'certificate_request_invalid', 'Every enrollment must belong to the class and appear once', {
      unknown: [...unknown],
      duplicates: [...duplicates],
    }),
  certificateNotFound: () => new CertificatesHttpException(HttpStatus.NOT_FOUND, 'certificate_not_found', 'No certificate matches'),
  certificateRevoked: (certificateId: string, revokedAt: string) =>
    new CertificatesHttpException(HttpStatus.CONFLICT, 'certificate_revoked', 'The certificate is already revoked', { certificateId, revokedAt }),
  cursorInvalid: () =>
    new CertificatesHttpException(HttpStatus.BAD_REQUEST, 'cursor_invalid', 'The cursor is invalid or belongs to a different order; restart from the first page'),
};
