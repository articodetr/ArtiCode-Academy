// Invoices (MOD-11-T03/T05): API-144/145/149 and «my invoices» API-155. Types
// mirror backend/src/finance/invoices.dto.ts and my-invoices.dto.ts; money is a
// JSON number with two decimals, computed by the server (paid, balance,
// installment parts, overdue — ADR-068). Reading needs `invoices.read_all`,
// `invoices.manage` or `payments.record` (any one); issuing and cancelling
// `invoices.manage`; «my invoices» `invoices.read_own` / `invoices.read_linked`.
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

export const INVOICE_STATUSES = ['draft', 'issued', 'cancelled'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const PAYMENT_STATES = ['unpaid', 'partial', 'paid'] as const
export type PaymentState = (typeof PAYMENT_STATES)[number]

export type InstallmentStatus = 'paid' | 'partial' | 'unpaid'
export type InvoiceStatusAction = 'issue' | 'cancel'

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'cheque', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export type PaymentStatus = 'completed' | 'reversed'

/** `REASON_MAX` of invoices.dto.ts: a cancel or reversal reason, 1..500 after trim. */
export const FINANCE_REASON_MAX = 500
/** `q` of API-144/API-152: part of the number, 1..32 characters. */
export const FINANCE_SEARCH_MAX_LENGTH = 32

export interface FinancePerson {
  id: string
  fullName: string
  displayName: string | null
}

export interface FinanceActor {
  fullName: string
}

export interface InvoiceEnrollment {
  id: string
  class: { id: string; code: string; name: LocalizedLabel }
}

export interface InvoiceNextDue {
  seq: number
  dueOn: string
  remaining: number
}

/** `InvoiceSummaryDto` (the list rows). */
export interface InvoiceSummary {
  id: string
  /** null for a draft. */
  number: string | null
  status: InvoiceStatus
  student: FinancePerson
  enrollment: InvoiceEnrollment | null
  feePlan: { id: string; name: LocalizedLabel } | null
  currency: string
  subtotal: number
  discountAmount: number
  discountReason: string | null
  total: number
  paid: number
  balance: number
  paymentState: PaymentState
  overdue: boolean
  nextDue: InvoiceNextDue | null
  issuedAt: string | null
  issuedBy: FinanceActor | null
  cancelledAt: string | null
  cancelReason: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface InvoiceLine {
  sortOrder: number
  description: LocalizedLabel
  amount: number
}

export interface InvoiceInstallment {
  seq: number
  amount: number
  dueOn: string
  paid: number
  remaining: number
  status: InstallmentStatus
  overdue: boolean
}

/** `InvoicePaymentDto`: a receipt as the invoice detail lists it, newest first. */
export interface InvoicePayment {
  id: string
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

/** `InvoiceDto` (API-145, API-149). */
export interface Invoice extends InvoiceSummary {
  lines: InvoiceLine[]
  installments: InvoiceInstallment[]
  payments: InvoicePayment[]
}

export interface InvoiceList {
  items: InvoiceSummary[]
  nextCursor: string | null
}

export interface ListInvoicesParams {
  studentId?: string
  classId?: string
  status?: InvoiceStatus
  balance?: PaymentState
  overdue?: boolean
  /** Part of the invoice number. */
  q?: string
  /** 1..100, server default 50. */
  limit?: number
  cursor?: string
}

/** Body of API-149: `reason` is required to cancel and not read on issue. */
export interface ChangeInvoiceStatusInput {
  action: InvoiceStatusAction
  reason?: string
}

export const INVOICES_PATH = '/api/invoices'
export const MY_INVOICES_PATH = '/api/me/invoices'

/** `/api/invoices?…` with the non-empty parameters only, in a fixed order. */
export function invoicesListPath(params: ListInvoicesParams = {}): string {
  const query = new URLSearchParams()
  if (params.studentId) query.set('studentId', params.studentId)
  if (params.classId) query.set('classId', params.classId)
  if (params.status) query.set('status', params.status)
  if (params.balance) query.set('balance', params.balance)
  if (params.overdue !== undefined) query.set('overdue', String(params.overdue))
  const q = params.q?.trim()
  if (q) query.set('q', q)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${INVOICES_PATH}?${search}` : INVOICES_PATH
}

export const invoicePath = (id: string) => `${INVOICES_PATH}/${encodeURIComponent(id)}`

/** API-144: newest first. */
export function listInvoices(params: ListInvoicesParams = {}, signal?: AbortSignal): Promise<InvoiceList> {
  return apiRequest<InvoiceList>(invoicesListPath(params), { signal })
}

/** API-145: lines, installments with their paid parts, and the payments. */
export function getInvoice(id: string, signal?: AbortSignal): Promise<Invoice> {
  return apiRequest<Invoice>(invoicePath(id), { signal })
}

/** API-149 (`invoices.manage`): issue a draft or cancel an issued invoice. */
export function changeInvoiceStatus(id: string, input: ChangeInvoiceStatusInput): Promise<Invoice> {
  return apiRequest<Invoice>(`${invoicePath(id)}/status`, { method: 'POST', body: input })
}

// ---------------------------------------------------------------------------
// Drafts (API-146/147/148) and the class batch (API-150) — `invoices.manage`
// ---------------------------------------------------------------------------

/** `INVOICE_NOTES_MAX` of invoices.dto.ts. */
export const INVOICE_NOTES_MAX = 2000

export interface InvoiceLineInput {
  description: LocalizedLabel
  amount: number
}

/** `InvoiceInstallmentInputDto`: an amount due on a day (`YYYY-MM-DD`). */
export interface InvoiceInstallmentInput {
  amount: number
  dueOn: string
}

/**
 * Body of API-146: either `feePlanId` (an active plan — its lines are copied and its shares split the total
 * from today in the academy zone) or `lines` + `installments` (summing to the total). The currency is the
 * academy's; the server refuses both or neither with `invoice_invalid { problems: [plan_with_lines | lines_required] }`.
 */
export interface CreateInvoiceInput {
  studentId: string
  enrollmentId?: string
  feePlanId?: string
  lines?: InvoiceLineInput[]
  installments?: InvoiceInstallmentInput[]
  /** One invoice-level discount (D-R64), within the subtotal. */
  discountAmount?: number
  /** Only with a discount. */
  discountReason?: string
  notes?: string
}

/** Body of API-147 (a draft only): absent = unchanged, `null` clears; lines and installments are replaced whole. */
export interface UpdateInvoiceInput {
  enrollmentId?: string | null
  lines?: InvoiceLineInput[]
  installments?: InvoiceInstallmentInput[]
  discountAmount?: number
  discountReason?: string | null
  notes?: string | null
}

/** Body of API-150. */
export interface IssueClassInvoicesInput {
  feePlanId: string
  /** true = issued at once with consecutive numbers; absent/false = drafts. */
  issue?: boolean
}

export type SkippedInvoiceReason = 'already_invoiced' | 'student_deleted'

export interface SkippedInvoice {
  enrollmentId: string
  studentId: string
  reason: SkippedInvoiceReason
}

/** `ClassInvoicesResultDto`. */
export interface ClassInvoicesResult {
  created: InvoiceSummary[]
  skipped: SkippedInvoice[]
}

/** API-146: a draft. */
export function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  return apiRequest<Invoice>(INVOICES_PATH, { method: 'POST', body: input })
}

/** API-147: the smallest change of a draft. */
export function updateInvoice(id: string, input: UpdateInvoiceInput): Promise<Invoice> {
  return apiRequest<Invoice>(invoicePath(id), { method: 'PATCH', body: input })
}

/** API-148: a draft only (`409 invoice_not_draft`). */
export function deleteInvoice(id: string): Promise<void> {
  return apiRequest<void>(invoicePath(id), { method: 'DELETE' })
}

export const classInvoicesPath = (classId: string) => `/api/classes/${encodeURIComponent(classId)}/invoices`

/** API-150: one invoice from the plan per active enrollment of the class; the others are `skipped` with their reason. */
export function issueClassInvoices(classId: string, input: IssueClassInvoicesInput): Promise<ClassInvoicesResult> {
  return apiRequest<ClassInvoicesResult>(classInvoicesPath(classId), { method: 'POST', body: input })
}

// ---------------------------------------------------------------------------
// «My invoices» (API-155)
// ---------------------------------------------------------------------------

export type MyInvoiceRelation = 'self' | 'child'

/** `MyInvoicePaymentDto`: a valid (completed) receipt as its owner sees it. */
export interface MyInvoicePayment {
  id: string
  number: string
  amount: number
  method: PaymentMethod
  paidAt: string
  reference: string | null
  payerName: string | null
}

/** `MyInvoiceItemDto`: the invoice without `notes`, `issuedBy`, `feePlan`; completed payments only. */
export interface MyInvoice extends Omit<Invoice, 'notes' | 'issuedBy' | 'feePlan' | 'payments'> {
  payments: MyInvoicePayment[]
  relation: MyInvoiceRelation
}

export interface ListMyInvoicesParams {
  studentId?: string
  classId?: string
  status?: 'issued' | 'cancelled'
}

export function myInvoicesPath(params: ListMyInvoicesParams = {}): string {
  const query = new URLSearchParams()
  if (params.studentId) query.set('studentId', params.studentId)
  if (params.classId) query.set('classId', params.classId)
  if (params.status) query.set('status', params.status)
  const search = query.toString()
  return search ? `${MY_INVOICES_PATH}?${search}` : MY_INVOICES_PATH
}

/** API-155: issued and cancelled invoices, newest first, no pagination. */
export function listMyInvoices(params: ListMyInvoicesParams = {}, signal?: AbortSignal): Promise<{ items: MyInvoice[] }> {
  return apiRequest<{ items: MyInvoice[] }>(myInvoicesPath(params), { signal })
}
