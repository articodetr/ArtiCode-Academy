// The rules of an enrollment request (MOD-19 — roadmap §4p, D-R121..D-R127,
// ADR-077) as pure functions, unit-tested in enrollment-requests.policy.spec.ts.
//
// A request is the enrollment row itself in the reserved `pending` status
// (D-R121): no table of its own and no second status column. What the people
// involved need to tell apart is computed on read:
//
//   * the PAYMENT state, from the invoices linked to the enrollment
//     (`invoices.enrollment_id`) — only `issued` invoices count; a draft is not
//     owed and a cancelled one is gone (ADR-068: computed, never stored);
//   * the REQUEST state the student and the office see, from the enrollment's
//     status, its rejection columns and that payment state.
//
// A "closed request" is a `cancelled` row that never became active — a request
// that was rejected or withdrawn by its student. A new request (or the office's
// API-058) reopens that row instead of refusing with `already_enrolled`; any
// other existing row still blocks (D-R121, one row per class × student).
import { Prisma } from '../generated/prisma/client.js';
import type { EnrollmentStatus, InvoiceStatus } from '../generated/prisma/client.js';

/**
 * `not_required` — the course is free now and nothing was invoiced;
 * `missing` — the course is paid but no invoice of the enrollment is issued
 * (the request's own invoice was cancelled and none replaced it);
 * `unpaid` / `partial` / `paid` — over the issued invoices together.
 */
export const REQUEST_PAYMENT_STATES = ['not_required', 'missing', 'unpaid', 'partial', 'paid'] as const;
export type RequestPaymentState = (typeof REQUEST_PAYMENT_STATES)[number];

/** What the student and the office see of a request (the spec's statuses, plus the later life of an approved one). */
export const REQUEST_STATES = ['pending_payment', 'pending_approval', 'enrolled', 'completed', 'withdrawn', 'rejected', 'cancelled'] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export interface InvoiceMoney {
  status: InvoiceStatus;
  totalAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
}

export interface PaymentTotals {
  state: RequestPaymentState;
  /** Sums over the issued invoices, as two-decimal strings. */
  total: string;
  paid: string;
  balance: string;
}

/**
 * The payment state of an enrollment from its invoices. A fully discounted
 * issued invoice (total 0, by `invoices.manage`) is `paid` — the explicit
 * waiver path (D-R125); nothing else can make a paid course `paid` without
 * money recorded through API-151.
 */
export function requestPayment(coursePaid: boolean, invoices: readonly InvoiceMoney[]): PaymentTotals {
  const issued = invoices.filter((invoice) => invoice.status === 'issued');
  const zero = new Prisma.Decimal(0);
  const total = issued.reduce((sum, invoice) => sum.plus(invoice.totalAmount), zero);
  const paid = issued.reduce((sum, invoice) => sum.plus(invoice.paidAmount), zero);
  const balance = total.minus(paid);
  const sums = { total: total.toFixed(2), paid: paid.toFixed(2), balance: balance.toFixed(2) };
  if (issued.length === 0) return { state: coursePaid ? 'missing' : 'not_required', ...sums };
  if (balance.lte(0)) return { state: 'paid', ...sums };
  return { state: paid.gt(0) ? 'partial' : 'unpaid', ...sums };
}

/** True when nothing more is owed for the enrollment — the money condition of `approve` (D-R125). */
export function paymentSettled(state: RequestPaymentState): boolean {
  return state === 'paid' || state === 'not_required';
}

/**
 * KI-155: a paid course's enrollment that was refunded and has nothing paid now
 * is not reactivated for free. A part-paid installment plan stays reactivatable.
 */
export function refundLeftNothingPaid(reversedPayments: number, state: RequestPaymentState): boolean {
  return reversedPayments > 0 && (state === 'missing' || state === 'unpaid');
}

export interface RequestRow {
  status: EnrollmentStatus;
  activatedAt: Date | null;
  rejectedAt: Date | null;
}

/** A request that ended without ever becoming an enrollment: rejected, or cancelled by its student. */
export function isClosedRequest(row: Pick<RequestRow, 'status' | 'activatedAt'>): boolean {
  return row.status === 'cancelled' && row.activatedAt === null;
}

/** The state shown for a requested enrollment. */
export function requestStateOf(row: RequestRow, payment: RequestPaymentState): RequestState {
  switch (row.status) {
    case 'pending':
      return paymentSettled(payment) ? 'pending_approval' : 'pending_payment';
    case 'active':
      return 'enrolled';
    case 'completed':
      return 'completed';
    case 'withdrawn':
      return 'withdrawn';
    case 'cancelled':
      return row.rejectedAt !== null ? 'rejected' : 'cancelled';
  }
}

/**
 * What an existing row of (class, student) means for a new request or a new
 * office enrollment: `none` — no row; `reopen` — a closed request, reused;
 * `pending` — a request waits; `taken` — any other row (enrolled now or
 * before), which `already_enrolled` refuses as API-058 always did.
 */
export type ExistingRow = 'none' | 'reopen' | 'pending' | 'taken';

export function existingRowKind(row: Pick<RequestRow, 'status' | 'activatedAt'> | null): ExistingRow {
  if (row === null) return 'none';
  if (row.status === 'pending') return 'pending';
  return isClosedRequest(row) ? 'reopen' : 'taken';
}
