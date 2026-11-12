// Invoices (MOD-11-T03 — owner decisions D-R59..D-R62, D-R64, D-R65):
// API-144 GET /api/invoices (keyset, newest first), API-145 GET /:id (lines,
// installments and payments), API-146 POST (a draft by hand or from an active
// fee plan), API-147 PATCH /:id and API-148 DELETE /:id (a draft only),
// API-149 POST /:id/status (`issue` draft → issued with `INV-YYYY-NNNNN`,
// `cancel` issued → cancelled with a reason) and API-150 POST
// /api/classes/:id/invoices (one invoice from a plan per active enrollment of
// a class). Reading needs `invoices.read_all`, `invoices.manage` or
// `payments.record` (any one); writing `invoices.manage`. Academy-wide — no
// class visibility. Paid parts, balance, payment state and overdue are
// computed by the server on every read (D-R62, ADR-068): the screens show
// them as returned and never compute them. Amounts are JSON numbers with two
// decimals in the invoice currency (the academy's — D-R59). Types mirror
// backend/src/finance/invoices.dto.ts field by field; every call goes through
// apiRequest (Bearer header, refresh-and-retry on 401).
import { apiRequest } from './client'
import type { FeePlanLine } from './feePlans'
import type { PaymentMethod, PaymentStatus } from './payments'
import type { LocalizedLabel } from './users'

export const INVOICE_STATUSES = ['draft', 'issued', 'cancelled'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

/** What is paid of an issued invoice (`PaymentState` of invoices.calc.ts) — the `balance` filter too. */
export const PAYMENT_STATES = ['unpaid', 'partial', 'paid'] as const
export type PaymentState = (typeof PAYMENT_STATES)[number]

/** `InstallmentStatus` of invoices.calc.ts: the paid amount covers the installments oldest first (D-R62). */
export const INSTALLMENT_STATUSES = ['paid', 'partial', 'unpaid'] as const
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number]

/** `INVOICE_STATUS_ACTIONS` of invoices.calc.ts (D-R61). */
export const INVOICE_STATUS_ACTIONS = ['issue', 'cancel'] as const
export type InvoiceStatusAction = (typeof INVOICE_STATUS_ACTIONS)[number]

/** `INVOICES_PAGE_DEFAULT` / `INVOICES_PAGE_MAX` of invoices.dto.ts. */
export const INVOICES_PAGE_DEFAULT = 50
export const INVOICES_PAGE_MAX = 100
/** `INVOICE_NOTES_MAX`: the internal note, 1..2000 characters after trimming. */
export const INVOICE_NOTES_MAX = 2000
/** `REASON_MAX`: a discount, cancellation or reversal reason, 1..500 characters after trimming. */
export const REASON_MAX = 500
/** The `q` filter (part of the invoice or receipt number): 1..32 characters after trimming. */
export const NUMBER_SEARCH_MAX_LENGTH = 32

/** `FinancePersonDto`: the student of an invoice or a receipt. */
export interface FinancePerson {
  id: string
  fullName: string
  displayName: string | null
}

/** `FinanceActorDto`: who issued an invoice or recorded/reversed a payment — by name only. */
export interface FinanceActor {
  fullName: string
}

/** `InvoiceClassDto`. */
export interface InvoiceClass {
  id: string
  code: string
  name: LocalizedLabel
}

/** `InvoiceEnrollmentDto`: the enrollment an invoice is tied to, with its class. */
export interface InvoiceEnrollment {
  id: string
  class: InvoiceClass
}

/** `InvoicePlanRefDto`: the fee plan a draft was created from (a copy — later plan changes do not reach it). */
export interface InvoicePlanRef {
  id: string
  name: LocalizedLabel
}

/** `InvoiceNextDueDto`: the first installment not fully covered. */
export interface InvoiceNextDue {
  seq: number
  /** `YYYY-MM-DD` */
  dueOn: string
  remaining: number
}

/** `InvoiceSummaryDto` (the items of API-144). */
export interface InvoiceSummary {
  id: string
  /** `INV-YYYY-NNNNN`; null for a draft. */
  number: string | null
  status: InvoiceStatus
  student: FinancePerson
  enrollment: InvoiceEnrollment | null
  feePlan: InvoicePlanRef | null
  /** ISO 4217, the academy's when the invoice was created (D-R59). */
  currency: string
  subtotal: number
  discountAmount: number
  discountReason: string | null
  total: number
  /** Sum of the completed payments. */
  paid: number
  /** total − paid. */
  balance: number
  paymentState: PaymentState
  /** An issued invoice with an installment due before today (academy zone) and not covered. */
  overdue: boolean
  /** The first installment not fully covered (issued invoices only), or null. */
  nextDue: InvoiceNextDue | null
  issuedAt: string | null
  issuedBy: FinanceActor | null
  cancelledAt: string | null
  cancelReason: string | null
  /** Internal note — never shown to the student or the guardian. */
  notes: string | null
  createdAt: string
  updatedAt: string
}

/** `InvoiceLineOutDto`. */
export interface InvoiceLine {
  sortOrder: number
  description: LocalizedLabel
  amount: number
}

/** `InvoiceInstallmentOutDto`: paid, remaining, status and overdue computed from the paid amount, oldest first (D-R62). */
export interface InvoiceInstallment {
  seq: number
  amount: number
  /** `YYYY-MM-DD` */
  dueOn: string
  paid: number
  remaining: number
  status: InstallmentStatus
  /** Issued invoices only. */
  overdue: boolean
}

/** `InvoicePaymentDto`: a payment of the invoice, completed or reversed (a reversed one stays on record). */
export interface InvoicePayment {
  id: string
  /** `RCPT-YYYY-NNNNN` */
  number: string
  amount: number
  method: PaymentMethod
  status: PaymentStatus
  paidAt: string
  reference: string | null
  payerName: string | null
  recordedBy: FinanceActor | null
  reversedAt: string | null
  reverseReason: string | null
}

/** `InvoiceDto` (API-145..API-147, API-149). */
export interface Invoice extends InvoiceSummary {
  lines: InvoiceLine[]
  installments: InvoiceInstallment[]
  /** Newest first. */
  payments: InvoicePayment[]
}

/** `InvoiceListDto`. */
export interface InvoiceList {
  /** Newest first. */
  items: InvoiceSummary[]
  nextCursor: string | null
}

/** `SkippedInvoiceReason`: a non-cancelled invoice from this plan exists for the enrollment, or the student was soft-deleted. */
export type SkippedInvoiceReason = 'already_invoiced' | 'student_deleted'

/** `SkippedInvoiceDto`. */
export interface SkippedInvoice {
  enrollmentId: string
  studentId: string
  reason: SkippedInvoiceReason
}

/** `ClassInvoicesResultDto` (API-150). */
export interface ClassInvoicesResult {
  created: InvoiceSummary[]
  skipped: SkippedInvoice[]
}

/** `InvoiceInstallmentInputDto`: an amount due on a day; the installments of an invoice sum to its total. */
export interface InvoiceInstallmentInput {
  /** 0.01..MONEY_MAX with at most two decimals. */
  amount: number
  /** `YYYY-MM-DD`, not before the previous installment. */
  dueOn: string
}

/**
 * Body of API-146 (`CreateInvoiceDto`): either `feePlanId` (an active plan — its
 * lines are copied and its shares split the total from today in the academy
 * zone) or `lines` + `installments`; one optional discount with its reason;
 * no currency (the academy's).
 */
export interface CreateInvoiceInput {
  studentId: string
  enrollmentId?: string
  feePlanId?: string
  lines?: FeePlanLine[]
  installments?: InvoiceInstallmentInput[]
  discountAmount?: number
  discountReason?: string
  notes?: string
}

/**
 * Body of API-147 (`UpdateInvoiceDto` — a draft only): absent = unchanged;
 * `null` clears the enrollment, the discount reason or the notes; `lines` and
 * `installments` are replaced whole; the draft must stay valid, so a changed
 * total travels with its installments.
 */
export interface UpdateInvoiceInput {
  enrollmentId?: string | null
  lines?: FeePlanLine[]
  installments?: InvoiceInstallmentInput[]
  discountAmount?: number
  discountReason?: string | null
  notes?: string | null
}

/** Body of API-149 (`ChangeInvoiceStatusDto`): `reason` (1..500) is required to cancel and not read on issue. */
export interface ChangeInvoiceStatusInput {
  action: InvoiceStatusAction
  reason?: string
}

/** Body of API-150 (`IssueClassInvoicesDto`): `issue` (a JSON boolean) issues the invoices at once instead of leaving drafts. */
export interface IssueClassInvoicesInput {
  feePlanId: string
  issue?: boolean
}

/** `ListInvoicesQueryDto`: ANDed filters. */
export interface ListInvoicesParams {
  studentId?: string
  enrollmentId?: string
  /** The invoices of the enrollments of this class. */
  classId?: string
  feePlanId?: string
  status?: InvoiceStatus
  /** Issued invoices by what is paid. */
  balance?: PaymentState
  /** true = issued invoices with an installment due before today and not covered; false = the others. */
  overdue?: boolean
  /** Part of the invoice number (literal, case-insensitive), 1..32 characters. */
  q?: string
  /** 1..100, server default 50. */
  limit?: number
  cursor?: string
}

export const INVOICES_PATH = '/api/invoices'

const invoicePath = (id: string) => `${INVOICES_PATH}/${encodeURIComponent(id)}`

/** `/api/invoices?…` with the given filters only, in a fixed order (trimmed number search). */
export function invoicesPath(params: ListInvoicesParams = {}): string {
  const query = new URLSearchParams()
  if (params.studentId) query.set('studentId', params.studentId)
  if (params.enrollmentId) query.set('enrollmentId', params.enrollmentId)
  if (params.classId) query.set('classId', params.classId)
  if (params.feePlanId) query.set('feePlanId', params.feePlanId)
  if (params.status) query.set('status', params.status)
  if (params.balance) query.set('balance', params.balance)
  // The literal text the server reads: only `true` and `false` are booleans there (queryBoolean).
  if (params.overdue !== undefined) query.set('overdue', params.overdue ? 'true' : 'false')
  const q = params.q?.trim()
  if (q) query.set('q', q)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${INVOICES_PATH}?${search}` : INVOICES_PATH
}

/** API-144: `403 permission_denied { missing: [invoices.read_all, invoices.manage, payments.record] }` without any of them. */
export function listInvoices(params: ListInvoicesParams = {}, signal?: AbortSignal): Promise<InvoiceList> {
  return apiRequest<InvoiceList>(invoicesPath(params), { signal })
}

/** API-145. */
export function getInvoice(id: string, signal?: AbortSignal): Promise<Invoice> {
  return apiRequest<Invoice>(invoicePath(id), { signal })
}

/** API-146 (201): a draft without a number. */
export function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  return apiRequest<Invoice>(INVOICES_PATH, { method: 'POST', body: input })
}

/** API-147: a draft only (`409 invoice_not_draft { status }`). */
export function updateInvoice(id: string, input: UpdateInvoiceInput): Promise<Invoice> {
  return apiRequest<Invoice>(invoicePath(id), { method: 'PATCH', body: input })
}

/** API-148: a draft only (an issued invoice is cancelled instead); resolves on 204. */
export function deleteInvoice(id: string): Promise<void> {
  return apiRequest<void>(invoicePath(id), { method: 'DELETE' })
}

/** API-149 (200): issue or cancel; answers with the invoice after the action. */
export function changeInvoiceStatus(id: string, input: ChangeInvoiceStatusInput): Promise<Invoice> {
  return apiRequest<Invoice>(`${invoicePath(id)}/status`, { method: 'POST', body: input })
}

/** API-150 (200): one invoice per active enrollment of the class without one from the plan; the others are `skipped`. */
export function issueClassInvoices(classId: string, input: IssueClassInvoicesInput): Promise<ClassInvoicesResult> {
  return apiRequest<ClassInvoicesResult>(`/api/classes/${encodeURIComponent(classId)}/invoices`, { method: 'POST', body: input })
}
