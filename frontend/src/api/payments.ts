// Payments (MOD-11-T04): API-151 record a payment on an issued invoice and
// API-154 reverse one. Types mirror backend/src/finance/payments.dto.ts.
// Recording needs `payments.record`, reversing `payments.refund`; the server
// keeps the amount within the balance (`payment_exceeds_balance`) and answers
// the receipt with its invoice as it stands now.
import { apiRequest } from './client'
import { invoicePath } from './invoices'
import type { FinanceActor, FinancePerson, InvoiceStatus, PaymentMethod, PaymentState, PaymentStatus } from './invoices'

export const PAYMENT_STATUSES = ['completed', 'reversed'] as const

/** `PAYMENT_TEXT_MAX` (reference, payer name) and `PAYMENT_NOTES_MAX` of payments.dto.ts. */
export const PAYMENT_TEXT_MAX = 200
export const PAYMENT_NOTES_MAX = 2000
/** `MONEY_MAX` of fee-plans.dto.ts. */
export const MONEY_MAX = 9_999_999_999.99

/** Body of API-151: absent `paidAt` = now on the server. */
export interface RecordPaymentInput {
  amount: number
  method: PaymentMethod
  /** ISO 8601 with an offset, not in the future. */
  paidAt?: string
  reference?: string
  payerName?: string
  notes?: string
}

/** `PaymentDto`: a receipt with its invoice as it stands now. */
export interface Payment {
  id: string
  number: string
  invoice: {
    id: string
    number: string | null
    status: InvoiceStatus
    currency: string
    total: number
    paid: number
    balance: number
    paymentState: PaymentState
  }
  student: FinancePerson
  amount: number
  currency: string
  method: PaymentMethod
  status: PaymentStatus
  paidAt: string
  reference: string | null
  payerName: string | null
  notes: string | null
  recordedBy: FinanceActor | null
  reversedAt: string | null
  reversedBy: FinanceActor | null
  reverseReason: string | null
  createdAt: string
}

export const PAYMENTS_PATH = '/api/payments'

export const invoicePaymentsPath = (invoiceId: string) => `${invoicePath(invoiceId)}/payments`
export const reversePaymentPath = (paymentId: string) => `${PAYMENTS_PATH}/${encodeURIComponent(paymentId)}/reverse`

/** API-151. */
export function recordPayment(invoiceId: string, input: RecordPaymentInput): Promise<Payment> {
  return apiRequest<Payment>(invoicePaymentsPath(invoiceId), { method: 'POST', body: input })
}

/** API-154: completed → reversed, for good, with a reason. */
export function reversePayment(paymentId: string, reason: string): Promise<Payment> {
  return apiRequest<Payment>(reversePaymentPath(paymentId), { method: 'POST', body: { reason } })
}

export interface PaymentList {
  /** Newest first (creation order). */
  items: Payment[]
  nextCursor: string | null
}

/** Query of API-152 (`ListPaymentsQueryDto`). */
export interface ListPaymentsParams {
  invoiceId?: string
  studentId?: string
  method?: PaymentMethod
  status?: PaymentStatus
  /** paidAt ≥ from — ISO 8601 with an offset. */
  from?: string
  /** paidAt < to — ISO 8601 with an offset. */
  to?: string
  /** Part of the receipt number, 1..32 characters. */
  q?: string
  /** 1..100, server default 50. */
  limit?: number
  cursor?: string
}

/** `/api/payments?…` with the non-empty parameters only, in a fixed order. */
export function paymentsListPath(params: ListPaymentsParams = {}): string {
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

export const paymentPath = (id: string) => `${PAYMENTS_PATH}/${encodeURIComponent(id)}`

/** API-152 (`invoices.read_all`, `invoices.manage` or `payments.record`). */
export function listPayments(params: ListPaymentsParams = {}, signal?: AbortSignal): Promise<PaymentList> {
  return apiRequest<PaymentList>(paymentsListPath(params), { signal })
}

/** API-153: one receipt with its invoice as it stands now. */
export function getPayment(id: string, signal?: AbortSignal): Promise<Payment> {
  return apiRequest<Payment>(paymentPath(id), { signal })
}
