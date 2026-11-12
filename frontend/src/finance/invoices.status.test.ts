import { describe, expect, it } from 'vitest'
import { FINANCE_ADMIN_PERMISSIONS, FINANCE_READER_PERMISSIONS, FINANCE_STAFF_PERMISSIONS } from '../test/feePlans'
import { makeDraftInvoice, makeInvoice } from '../test/invoices'
import { acceptsPayment, availableInvoiceActions, cancelBlocker, canReversePayment, completedPaymentCount } from './invoices.status'

describe('invoice actions (D-R61, D-R63, D-R65)', () => {
  it('offers a draft edit, issue and delete to invoices.manage — and nothing to a reader', () => {
    expect(availableInvoiceActions(makeDraftInvoice(), FINANCE_STAFF_PERMISSIONS)).toEqual(['edit', 'issue', 'delete'])
    expect(availableInvoiceActions(makeDraftInvoice(), FINANCE_READER_PERMISSIONS)).toEqual([])
    // A draft takes no payment, whatever the keys.
    expect(availableInvoiceActions(makeDraftInvoice(), ['payments.record'])).toEqual([])
  })

  it('offers an issued invoice with a balance a payment (payments.record) and a cancellation (invoices.manage)', () => {
    expect(availableInvoiceActions(makeInvoice(), FINANCE_ADMIN_PERMISSIONS)).toEqual(['record', 'cancel'])
    expect(availableInvoiceActions(makeInvoice(), ['payments.record'])).toEqual(['record'])
    expect(availableInvoiceActions(makeInvoice({ balance: 0, paymentState: 'paid' }), FINANCE_ADMIN_PERMISSIONS)).toEqual(['cancel'])
    expect(availableInvoiceActions(makeInvoice({ status: 'cancelled' }), FINANCE_ADMIN_PERMISSIONS)).toEqual([])
  })

  it('blocks the cancellation while a completed payment stands (invoice_has_payments), counting the completed ones only', () => {
    const invoice = makeInvoice()
    expect(completedPaymentCount(invoice)).toBe(1)
    expect(cancelBlocker(invoice)).toEqual({ paymentCount: 1 })
    expect(cancelBlocker(makeInvoice({ payments: makeInvoice().payments.filter((payment) => payment.status === 'reversed') }))).toBeNull()
    expect(cancelBlocker(makeDraftInvoice())).toBeNull()
    expect(acceptsPayment(makeInvoice())).toBe(true)
    expect(acceptsPayment(makeInvoice({ balance: 0 }))).toBe(false)
  })

  it('lets payments.refund alone reverse a completed payment', () => {
    const [reversed, completed] = makeInvoice().payments
    expect(canReversePayment(completed!, FINANCE_ADMIN_PERMISSIONS)).toBe(true)
    expect(canReversePayment(reversed!, FINANCE_ADMIN_PERMISSIONS)).toBe(false)
    expect(canReversePayment(completed!, FINANCE_STAFF_PERMISSIONS)).toBe(false)
  })
})
