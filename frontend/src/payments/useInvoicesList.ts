// The office invoices list (API-144) on the shared keyset hook.
import { listInvoices } from '../api/invoices'
import type { InvoiceStatus, InvoiceSummary, PaymentState } from '../api/invoices'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'

export const INVOICE_PAGE_SIZES = [20, 50, 100] as const

export interface InvoicesListFilters {
  q?: string
  studentId?: string
  status?: InvoiceStatus
  balance?: PaymentState
  /** true = overdue only; absent = every invoice. */
  overdue?: boolean
  limit: (typeof INVOICE_PAGE_SIZES)[number]
}

export const DEFAULT_INVOICE_FILTERS: InvoicesListFilters = { limit: 20 }

const loadInvoices: KeysetLoader<InvoiceSummary, InvoicesListFilters> = (filters, cursor, signal) =>
  listInvoices({ ...filters, overdue: filters.overdue ? true : undefined, cursor }, signal)

export function useInvoicesList() {
  return useKeysetList<InvoiceSummary, InvoicesListFilters>(loadInvoices, DEFAULT_INVOICE_FILTERS)
}
