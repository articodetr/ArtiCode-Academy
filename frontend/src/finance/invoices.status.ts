// What a caller may do with an invoice and its payments (J-F52): the status
// machine of D-R61 (a manual mirror of `allowedInvoiceActions()` /
// `nextInvoiceStatus()` in backend/src/finance/invoices.calc.ts — keep in
// sync) crossed with the keys of D-R65 and the server's refusals that the
// invoice as read already tells: a draft is edited, issued or deleted with
// `invoices.manage`; an issued invoice is cancelled with `invoices.manage`
// while no completed payment stands (`invoice_has_payments` — reverse them
// first); a payment is recorded on an issued invoice with a balance left
// (`payments.record`) and a completed payment is reversed with
// `payments.refund`. The server stays the boundary. No React.
import type { Invoice, InvoicePayment, InvoiceSummary } from '../api/invoices'
import { INVOICES_MANAGE_PERMISSION, PAYMENTS_RECORD_PERMISSION, PAYMENTS_REFUND_PERMISSION } from './finance.policy'
import { nextInvoiceStatus } from './invoices.rules'

export type InvoiceMenuAction = 'edit' | 'issue' | 'delete' | 'cancel' | 'record'

/** The completed payments of an invoice — what blocks its cancellation (`invoice_has_payments { paymentCount }`). */
export function completedPaymentCount(invoice: Pick<Invoice, 'payments'>): number {
  return invoice.payments.filter((payment) => payment.status === 'completed').length
}

/** Why an issued invoice cannot be cancelled now, or null: the payments that still stand. */
export function cancelBlocker(invoice: Pick<Invoice, 'status' | 'payments'>): { paymentCount: number } | null {
  if (invoice.status !== 'issued') return null
  const paymentCount = completedPaymentCount(invoice)
  return paymentCount > 0 ? { paymentCount } : null
}

/** Whether a payment can be recorded on the invoice now: issued, with a balance the server says is left. */
export function acceptsPayment(invoice: Pick<InvoiceSummary, 'status' | 'balance'>): boolean {
  return invoice.status === 'issued' && invoice.balance > 0
}

/** The actions the caller sees for the invoice, in menu order (a blocked cancel is shown disabled by the screen). */
export function availableInvoiceActions(invoice: Pick<InvoiceSummary, 'status' | 'balance'>, permissions: readonly string[]): InvoiceMenuAction[] {
  const actions: InvoiceMenuAction[] = []
  const manage = permissions.includes(INVOICES_MANAGE_PERMISSION)
  if (manage && invoice.status === 'draft') actions.push('edit')
  if (manage && nextInvoiceStatus('issue', invoice.status)) actions.push('issue')
  if (permissions.includes(PAYMENTS_RECORD_PERMISSION) && acceptsPayment(invoice)) actions.push('record')
  if (manage && nextInvoiceStatus('cancel', invoice.status)) actions.push('cancel')
  // API-148: a draft only — an issued invoice is cancelled instead.
  if (manage && invoice.status === 'draft') actions.push('delete')
  return actions
}

/** Whether the caller may reverse this payment: a completed one, with `payments.refund`. */
export function canReversePayment(payment: Pick<InvoicePayment, 'status'>, permissions: readonly string[]): boolean {
  return payment.status === 'completed' && permissions.includes(PAYMENTS_REFUND_PERMISSION)
}
