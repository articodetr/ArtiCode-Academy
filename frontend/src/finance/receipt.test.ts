import { describe, expect, it } from 'vitest'
import { INVOICE_PAYMENT_IDS } from '../test/invoices'
import { makeChildInvoice, makeMyInvoice } from '../test/myInvoices'
import { makePayment, makeReversedPayment } from '../test/payments'
import { findMyReceipt, receiptOfMyInvoice, receiptOfPayment } from './receipt'
import { classOptionsOf, studentOptionsOf } from './useMyInvoices'

describe('the printed receipt', () => {
  it('takes the office’s copy with its recorder and reversal, never the internal note', () => {
    const receipt = receiptOfPayment(makeReversedPayment())
    expect(receipt).toMatchObject({ number: 'RCPT-2026-00032', status: 'reversed', amount: 400, currency: 'SAR', method: 'bank_transfer', invoiceNumber: 'INV-2026-00057', invoiceBalance: 600, recordedBy: 'مدير الاختبار', reverseReason: 'تحويل مكرر' })
    expect(Object.values(receiptOfPayment(makePayment()))).not.toContain('سُلّمت للمحاسب')
  })

  it('finds the owner’s valid receipt in «my invoices», and nothing for a reversed one', () => {
    const items = [makeChildInvoice(), makeMyInvoice()]
    const found = findMyReceipt(items, INVOICE_PAYMENT_IDS[0])
    expect(found?.invoice.number).toBe('INV-2026-00057')
    expect(receiptOfMyInvoice(found!.invoice, found!.payment)).toMatchObject({ number: 'RCPT-2026-00031', status: 'completed', amount: 600, studentName: 'عمر خالد', recordedBy: null, invoicePaid: 600 })
    // RCPT-2026-00032 was reversed: the owner projection does not carry it.
    expect(findMyReceipt(items, INVOICE_PAYMENT_IDS[1])).toBeNull()
  })
})

describe('the «my invoices» filter options', () => {
  it('lists the caller first, then the children by name, and the classes by code', () => {
    const items = [makeChildInvoice(), makeMyInvoice()]
    expect(studentOptionsOf(items).map((student) => [student.fullName, student.relation])).toEqual([
      ['عمر خالد', 'self'],
      ['ليلى سعيد', 'child'],
    ])
    expect(classOptionsOf(items).map((klass) => klass.code)).toEqual(['PY-101-A'])
  })
})
