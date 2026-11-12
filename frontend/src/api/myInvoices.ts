// «My invoices» (MOD-11-T05 — owner decision D-R65, the pattern of «my
// certificates»): API-155 GET /api/me/invoices. Ownership plus the 7.2 keys:
// the caller's own invoices with `invoices.read_own` (`relation: self`) and —
// while the caller holds the `guardian` role — their linked, not soft-deleted
// children's with `invoices.read_linked` (`relation: child`); a caller holding
// neither key gets `403 permission_denied { missing: [both] }`. Issued and
// cancelled invoices only (a draft is the office's — a `draft` filter is a
// 400), newest first, no pagination. Each item is API-145's invoice without the
// internal note, the issuer and the fee plan, with the completed payments only
// (the valid receipts, without their recorder or note) — paid parts, balance
// and overdue computed by the server (ADR-068). Types mirror
// backend/src/finance/my-invoices.dto.ts field by field.
import { apiRequest } from './client'
import type { MyClassRelation } from './enrollments'
import type { Invoice } from './invoices'
import type { PaymentMethod } from './payments'

/** `invoices.read_own` / `invoices.read_linked` (finance.policy.ts): either opens API-155. */
export const READ_OWN_INVOICES_PERMISSION = 'invoices.read_own'
export const READ_LINKED_INVOICES_PERMISSION = 'invoices.read_linked'

/** The statuses an owner sees (`OWNER_STATUSES`). */
export const MY_INVOICE_STATUSES = ['issued', 'cancelled'] as const
export type MyInvoiceStatus = (typeof MY_INVOICE_STATUSES)[number]

/** `MyInvoicePaymentDto`: a valid receipt as its owner sees it. */
export interface MyInvoicePayment {
  id: string
  /** `RCPT-YYYY-NNNNN` */
  number: string
  amount: number
  method: PaymentMethod
  paidAt: string
  reference: string | null
  payerName: string | null
}

/**
 * `MyInvoiceItemDto` = `OmitType(InvoiceDto, ['notes', 'issuedBy', 'feePlan', 'payments'])`
 * + the completed payments and the relation.
 */
export interface MyInvoiceItem extends Omit<Invoice, 'notes' | 'issuedBy' | 'feePlan' | 'payments'> {
  /** Completed payments (the valid receipts), newest first. */
  payments: MyInvoicePayment[]
  /** `self` (invoices.read_own) or `child` (invoices.read_linked and the guardian role). */
  relation: MyClassRelation
}

/** `MyInvoiceListDto`. */
export interface MyInvoiceList {
  /** Issued and cancelled invoices, newest first. */
  items: MyInvoiceItem[]
}

/** `ListMyInvoicesQueryDto`. */
export interface ListMyInvoicesParams {
  /** The caller or one of their linked children — anyone else matches nothing. */
  studentId?: string
  /** The invoices tied to an enrollment of this class. */
  classId?: string
  status?: MyInvoiceStatus
}

export const MY_INVOICES_PATH = '/api/me/invoices'

/** `/api/me/invoices?…` with the given filters only, in a fixed order. */
export function myInvoicesPath(params: ListMyInvoicesParams = {}): string {
  const query = new URLSearchParams()
  if (params.studentId) query.set('studentId', params.studentId)
  if (params.classId) query.set('classId', params.classId)
  if (params.status) query.set('status', params.status)
  const search = query.toString()
  return search ? `${MY_INVOICES_PATH}?${search}` : MY_INVOICES_PATH
}

/** API-155. */
export function listMyInvoices(params: ListMyInvoicesParams = {}, signal?: AbortSignal): Promise<MyInvoiceList> {
  return apiRequest<MyInvoiceList>(myInvoicesPath(params), { signal })
}
