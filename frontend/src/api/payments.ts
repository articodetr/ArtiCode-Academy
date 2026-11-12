// Payments and receipts (MOD-11-T04 — owner decision D-R63): API-151 POST
// /api/invoices/:id/payments (`payments.record` — a manual payment of an issued
// invoice, at most its balance, receipt `RCPT-YYYY-NNNNN`), API-152 GET
// /api/payments (keyset, newest first) and API-153 GET /:id (the read keys of
// the invoices: `invoices.read_all`, `invoices.manage` or `payments.record`),
// and API-154 POST /:id/reverse (`payments.refund` — completed → reversed for
// good, with a reason; the payment stays on record). A payment is never
// edited. Each receipt carries its invoice as it stands now (total, paid,
// balance — the server's). Types mirror backend/src/finance/payments.dto.ts
// field by field; every call goes through apiRequest.
import { apiRequest } from './client'
import type { FinanceActor, FinancePerson, InvoiceStatus, PaymentState } from './invoices'

/** `PaymentMethod` of the schema (`payment_method`). */
export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'cheque', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/** `PaymentStatus` of the schema (`payment_status`). */
export const PAYMENT_STATUSES = ['completed', 'reversed'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

/** `PAYMENTS_PAGE_DEFAULT` / `PAYMENTS_PAGE_MAX` of payments.dto.ts. */
export const PAYMENTS_PAGE_DEFAULT = 50
export const PAYMENTS_PAGE_MAX = 100
/** `PAYMENT_TEXT_MAX`: the reference and the payer name, 1..200 characters after trimming. */
export const PAYMENT_TEXT_MAX = 200
/** `PAYMENT_NOTES_MAX`: the internal note of a payment, 1..2000 characters after trimming. */
export const PAYMENT_NOTES_MAX = 2000
/** `PAID_AT_SKEW_MS` of payments.rules.ts: `paidAt` may be at most this far ahead of the server clock. */
export const PAID_AT_SKEW_MS = 5 * 60 * 1000

/** `PaymentInvoiceDto`: the invoice a payment belongs to, as it stands now. */
export interface PaymentInvoice {
  id: string
  number: string | null
  status: InvoiceStatus
  currency: string
  total: number
  paid: number
  balance: number
  paymentState: PaymentState
}

/** `PaymentDto`: a receipt (D-R63). */
export interface Payment {
  id: string
  /** `RCPT-YYYY-NNNNN` */
  number: string
  invoice: PaymentInvoice
  student: FinancePerson
  amount: number
  /** The invoice currency. */
  currency: string
  method: PaymentMethod
  status: PaymentStatus
  /** When the money was received (ISO 8601). */
  paidAt: string
  reference: string | null
  payerName: string | null
  /** Internal note — never printed on a receipt, never shown to the student or the guardian. */
  notes: string | null
  recordedBy: FinanceActor | null
  reversedAt: string | null
  reversedBy: FinanceActor | null
  reverseReason: string | null
  createdAt: string
}

/** `PaymentListDto`. */
export interface PaymentList {
  /** Newest first (creation order). */
  items: Payment[]
  nextCursor: string | null
}

/**
 * Body of API-151 (`RecordPaymentDto`): `amount` a JSON number with two decimals
 * at most, not above the invoice balance; `paidAt` an ISO 8601 instant with an
 * offset, not in the future (5 minutes of clock skew tolerated) — default now;
 * the texts are trimmed and never blank. No currency (the invoice's).
 */
export interface RecordPaymentInput {
  amount: number
  method: PaymentMethod
  paidAt?: string
  reference?: string
  payerName?: string
  notes?: string
}

/** Body of API-154 (`ReversePaymentDto`): the reason (1..500 after trimming), kept on the payment. */
export interface ReversePaymentInput {
  reason: string
}

/** `ListPaymentsQueryDto`: ANDed filters. */
export interface ListPaymentsParams {
  invoiceId?: string
  /** The payments of this student’s invoices. */
  studentId?: string
  method?: PaymentMethod
  status?: PaymentStatus
  /** `paidAt ≥ from` (ISO 8601 with an offset). */
  from?: string
  /** `paidAt < to` (ISO 8601 with an offset) — exclusive. */
  to?: string
  /** Part of the receipt number (literal, case-insensitive), 1..32 characters. */
  q?: string
  /** 1..100, server default 50. */
  limit?: number
  cursor?: string
}

export const PAYMENTS_PATH = '/api/payments'

const paymentPath = (id: string) => `${PAYMENTS_PATH}/${encodeURIComponent(id)}`

/** `/api/payments?…` with the given filters only, in a fixed order (trimmed receipt search). */
export function paymentsPath(params: ListPaymentsParams = {}): string {
  const query = new URLSearchParams()
  if (params.invoiceId) query.set('invoiceId', params.invoiceId)
  if (params.studentId) query.set('studentId', params.studentId)
  if (params.method) query.set('method', params.method)
  if (params.status) query.set('status', params.status)
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  const q = params.q?.trim()
  if (q) query.set('q', q)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${PAYMENTS_PATH}?${search}` : PAYMENTS_PATH
}

/** API-151 (201): the receipt, with the invoice's paid amount and balance after it. */
export function recordPayment(invoiceId: string, input: RecordPaymentInput): Promise<Payment> {
  return apiRequest<Payment>(`/api/invoices/${encodeURIComponent(invoiceId)}/payments`, { method: 'POST', body: input })
}

/** API-152: the read keys of the invoices (`payments.refund` alone reads nothing). */
export function listPayments(params: ListPaymentsParams = {}, signal?: AbortSignal): Promise<PaymentList> {
  return apiRequest<PaymentList>(paymentsPath(params), { signal })
}

/** API-153. */
export function getPayment(id: string, signal?: AbortSignal): Promise<Payment> {
  return apiRequest<Payment>(paymentPath(id), { signal })
}

/** API-154 (200): `409 payment_reversed { paymentId, reversedAt }` for a payment already reversed. */
export function reversePayment(id: string, input: ReversePaymentInput): Promise<Payment> {
  return apiRequest<Payment>(`${paymentPath(id)}/reverse`, { method: 'POST', body: input })
}
