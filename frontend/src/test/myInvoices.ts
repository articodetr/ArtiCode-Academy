// Fixtures for «my invoices» and the owner's receipt page (MOD-11 — J-F52): the
// shape of API-155 as backend/src/finance/my-invoices.service.ts returns it —
// API-145's invoice without the internal note, the issuer and the fee plan,
// with the completed payments only (seven fields each) and the relation.
import type { MyInvoiceItem, MyInvoiceList } from '../api/myInvoices'
import { STUDENT_IDS } from './enrollments'
import { INVOICE_IDS, makeInvoice, makeOverdueInvoice } from './invoices'
import type { Invoice } from '../api/invoices'

/** The student's key by seed (`invoices.read_own`). */
export const STUDENT_INVOICE_PERMISSIONS = ['courses.read', 'invoices.read_own']
/** The guardian's key by seed (`invoices.read_linked`). */
export const GUARDIAN_INVOICE_PERMISSIONS = ['courses.read', 'invoices.read_linked']

/** The owner's projection of an invoice (`toInvoiceDto()` → the fields of MyInvoiceItemDto, completed payments only). */
export function ownerViewOf(invoice: Invoice, relation: MyInvoiceItem['relation'] = 'self'): MyInvoiceItem {
  const { notes: _notes, issuedBy: _issuedBy, feePlan: _feePlan, payments, ...rest } = invoice
  void _notes
  void _issuedBy
  void _feePlan
  return {
    ...rest,
    payments: payments
      .filter((payment) => payment.status === 'completed')
      .map((payment) => ({ id: payment.id, number: payment.number, amount: payment.amount, method: payment.method, paidAt: payment.paidAt, reference: payment.reference, payerName: payment.payerName })),
    relation,
  }
}

/** INV-2026-00057 as its student reads it: one valid receipt (the reversed one is not there). */
export function makeMyInvoice(overrides: Partial<MyInvoiceItem> = {}): MyInvoiceItem {
  return { ...ownerViewOf(makeInvoice()), ...overrides }
}

/** A child's overdue invoice as their guardian reads it. */
export function makeChildInvoice(overrides: Partial<MyInvoiceItem> = {}): MyInvoiceItem {
  return {
    ...ownerViewOf(makeOverdueInvoice({ id: INVOICE_IDS[2], student: { id: STUDENT_IDS[1], fullName: 'ليلى سعيد', displayName: null }, enrollment: null }), 'child'),
    ...overrides,
  }
}

export function makeMyInvoiceList(items: MyInvoiceItem[]): MyInvoiceList {
  return { items }
}
