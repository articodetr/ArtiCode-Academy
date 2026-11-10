// Error vocabulary of MOD-11 payments and installments (roadmap §4i.4, owner
// decisions D-R58..D-R65). One dictionary for the whole module, complete from
// T02 on so T03..T05 only use it. Same shape as the other module dictionaries:
// the body is `{ statusCode, error, code, message, ...details }` and the
// frontend maps the stable `code`. A detail is never named `code`.
//
//   -- fee plans (T02) --
//   fee_plan_not_found        404 — no fee plan with this id
//   fee_plan_invalid          400 — the plan breaks a rule ({ problems }: course_and_class,
//                                   percent_sum, offsets_not_ascending)
//   fee_plan_in_use           409 — invoices were created from the plan; deactivate it ({ invoiceCount })
//   fee_plan_inactive         409 — an inactive plan creates no invoice ({ feePlanId })
//   course_not_found          404 — the plan's course does not exist ({ courseId })
//   class_not_found           404 — the plan's or the batch's class does not exist ({ classId })
//   -- invoices (T03) --
//   invoice_not_found         404 — no invoice with this id
//   student_not_found         404 — no student with this id ({ studentId })
//   enrollment_mismatch       422 — the enrollment belongs to another student ({ enrollmentId })
//   invoice_invalid           400 — the invoice breaks a rule ({ problems }: no_lines,
//                                   installments_sum, discount_exceeds_subtotal, total_zero, …)
//   invoice_not_draft         409 — only a draft is edited or deleted ({ status })
//   invoice_not_issued        409 — payments are recorded on an issued invoice only ({ status })
//   invoice_has_payments      409 — an invoice with completed payments is not cancelled ({ paymentCount })
//   invalid_transition        409 — status action not allowed from the current state ({ from, action, allowed })
//   -- payments (T04) --
//   payment_exceeds_balance   409 — the amount is above the balance ({ amount, balance })
//   payment_not_found         404 — no payment with this id
//   payment_reversed          409 — the payment is already reversed ({ paymentId, reversedAt })
//   -- shared --
//   nothing_to_update         400 — PATCH body without any field
//   cursor_invalid            400 — the list cursor does not belong to this order
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const FINANCE_ERROR_CODES = [
  'fee_plan_not_found',
  'fee_plan_invalid',
  'fee_plan_in_use',
  'fee_plan_inactive',
  'course_not_found',
  'class_not_found',
  'invoice_not_found',
  'student_not_found',
  'enrollment_mismatch',
  'invoice_invalid',
  'invoice_not_draft',
  'invoice_not_issued',
  'invoice_has_payments',
  'invalid_transition',
  'payment_exceeds_balance',
  'payment_not_found',
  'payment_reversed',
  'nothing_to_update',
  'cursor_invalid',
] as const;

export type FinanceErrorCode = (typeof FINANCE_ERROR_CODES)[number];

export interface FinanceErrorBody {
  statusCode: number;
  error: string;
  code: FinanceErrorCode;
  message: string;
  [detail: string]: unknown;
}

export class FinanceHttpException extends HttpException {
  readonly code: FinanceErrorCode;

  constructor(status: HttpStatus, code: FinanceErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: FinanceErrorBody = { statusCode: status, error: STATUS_CODES[status] ?? 'Error', code, message, ...details };
    super(body, status);
    this.code = code;
  }
}

export type FeePlanProblem = 'course_and_class' | 'percent_sum' | 'offsets_not_ascending';
export type InvoiceProblem = 'no_lines' | 'installments_sum' | 'discount_exceeds_subtotal' | 'total_zero' | 'no_installments' | 'seq_not_consecutive' | 'due_dates_not_ascending' | 'discount_reason_without_discount';

export const financeError = {
  feePlanNotFound: (feePlanId: string) => new FinanceHttpException(HttpStatus.NOT_FOUND, 'fee_plan_not_found', 'No fee plan with this id', { feePlanId }),
  feePlanInvalid: (problems: readonly FeePlanProblem[]) =>
    new FinanceHttpException(HttpStatus.BAD_REQUEST, 'fee_plan_invalid', 'The fee plan breaks its rules', { problems: [...problems] }),
  feePlanInUse: (invoiceCount: number) =>
    new FinanceHttpException(HttpStatus.CONFLICT, 'fee_plan_in_use', 'Invoices were created from this fee plan; deactivate it instead', { invoiceCount }),
  feePlanInactive: (feePlanId: string) => new FinanceHttpException(HttpStatus.CONFLICT, 'fee_plan_inactive', 'An inactive fee plan creates no invoice', { feePlanId }),
  courseNotFound: (courseId: string) => new FinanceHttpException(HttpStatus.NOT_FOUND, 'course_not_found', 'No course with this id', { courseId }),
  classNotFound: (classId: string) => new FinanceHttpException(HttpStatus.NOT_FOUND, 'class_not_found', 'No class with this id', { classId }),
  invoiceNotFound: (invoiceId: string) => new FinanceHttpException(HttpStatus.NOT_FOUND, 'invoice_not_found', 'No invoice with this id', { invoiceId }),
  studentNotFound: (studentId: string) => new FinanceHttpException(HttpStatus.NOT_FOUND, 'student_not_found', 'No student with this id', { studentId }),
  enrollmentMismatch: (enrollmentId: string) =>
    new FinanceHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'enrollment_mismatch', 'The enrollment belongs to another student', { enrollmentId }),
  invoiceInvalid: (problems: readonly InvoiceProblem[]) =>
    new FinanceHttpException(HttpStatus.BAD_REQUEST, 'invoice_invalid', 'The invoice breaks its rules', { problems: [...problems] }),
  invoiceNotDraft: (status: string) => new FinanceHttpException(HttpStatus.CONFLICT, 'invoice_not_draft', 'Only a draft invoice can be changed or deleted', { status }),
  invoiceNotIssued: (status: string) => new FinanceHttpException(HttpStatus.CONFLICT, 'invoice_not_issued', 'Payments are recorded on an issued invoice only', { status }),
  invoiceHasPayments: (paymentCount: number) =>
    new FinanceHttpException(HttpStatus.CONFLICT, 'invoice_has_payments', 'Reverse the completed payments before cancelling the invoice', { paymentCount }),
  invalidTransition: (from: string, action: string, allowed: readonly string[]) =>
    new FinanceHttpException(HttpStatus.CONFLICT, 'invalid_transition', `Action "${action}" is not allowed for a ${from} invoice`, { from, action, allowed: [...allowed] }),
  paymentExceedsBalance: (amount: number, balance: number) =>
    new FinanceHttpException(HttpStatus.CONFLICT, 'payment_exceeds_balance', 'The payment is above the invoice balance', { amount, balance }),
  paymentNotFound: (paymentId: string) => new FinanceHttpException(HttpStatus.NOT_FOUND, 'payment_not_found', 'No payment with this id', { paymentId }),
  paymentReversed: (paymentId: string, reversedAt: string) =>
    new FinanceHttpException(HttpStatus.CONFLICT, 'payment_reversed', 'The payment is already reversed', { paymentId, reversedAt }),
  nothingToUpdate: () => new FinanceHttpException(HttpStatus.BAD_REQUEST, 'nothing_to_update', 'The request body contains no field to update'),
  cursorInvalid: () =>
    new FinanceHttpException(HttpStatus.BAD_REQUEST, 'cursor_invalid', 'The cursor is invalid or belongs to a different order; restart from the first page'),
};
