// State of the invoices table (J-F52): API-144 through the shared keyset hook,
// newest first, with the filters the contract offers — part of the number, the
// stored status, what is paid of an issued invoice (`balance`), overdue, the
// class, the student and the fee plan. The paid state and overdue are the
// server's (computed on read — D-R62): the page filters by them, never
// computes them.
import { listInvoices } from '../api/invoices'
import type { InvoiceStatus, InvoiceSummary, PaymentState } from '../api/invoices'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'

export const INVOICE_PAGE_SIZES = [20, 50, 100] as const

export interface InvoicesListFilters {
  /** Part of the invoice number (sent trimmed, 1..32 characters). */
  q: string
  status: InvoiceStatus | undefined
  balance: PaymentState | undefined
  /** true = overdue only, false = not overdue, undefined = both. */
  overdue: boolean | undefined
  classId: string | undefined
  studentId: string | undefined
  feePlanId: string | undefined
  limit: (typeof INVOICE_PAGE_SIZES)[number]
}

export const DEFAULT_INVOICE_FILTERS: InvoicesListFilters = {
  q: '',
  status: undefined,
  balance: undefined,
  overdue: undefined,
  classId: undefined,
  studentId: undefined,
  feePlanId: undefined,
  limit: 20,
}

/** True when the list is narrowed (the page size narrows nothing). */
export function hasActiveInvoiceFilters(filters: InvoicesListFilters): boolean {
  return Boolean(filters.q.trim() || filters.status || filters.balance || filters.overdue !== undefined || filters.classId || filters.studentId || filters.feePlanId)
}

const loadInvoices: KeysetLoader<InvoiceSummary, InvoicesListFilters> = (filters, cursor, signal) =>
  listInvoices(
    {
      q: filters.q,
      status: filters.status,
      balance: filters.balance,
      overdue: filters.overdue,
      classId: filters.classId,
      studentId: filters.studentId,
      feePlanId: filters.feePlanId,
      limit: filters.limit,
      cursor,
    },
    signal,
  )

export function useInvoicesList() {
  return useKeysetList(loadInvoices, DEFAULT_INVOICE_FILTERS)
}
