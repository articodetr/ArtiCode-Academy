import { describe, expect, it } from 'vitest'
import { PAID_AT_SKEW_MS } from '../api/payments'
import { makeInvoice, makeOverdueInvoice } from '../test/invoices'
import { buildRecordPaymentInput, exceedsBalance, isFutureInstant, localDateTimeOf, newRecordPaymentForm, paidAtOf, recordPaymentFormHasChanges } from './payments.form'

describe('the «record a payment» form — mirrors of payments.rules.ts', () => {
  const now = new Date(2026, 10, 12, 9, 30)

  it('starts from what the server says is due next, else the balance; cash; received now', () => {
    expect(newRecordPaymentForm(makeInvoice(), now)).toMatchObject({ amount: 600, method: 'cash', receivedNow: true, paidDate: '2026-11-12', paidTime: '09:30' })
    expect(newRecordPaymentForm(makeInvoice({ nextDue: null, balance: 250 }), now).amount).toBe(250)
    expect(newRecordPaymentForm(makeOverdueInvoice(), now).amount).toBe(600)
  })

  it('refuses an amount above the balance the server sent (exceedsBalance) in cents', () => {
    expect(exceedsBalance(200.01, 200)).toBe(true)
    expect(exceedsBalance(200, 200)).toBe(false)
    expect(exceedsBalance(0.3, 0.1 + 0.2)).toBe(false)
  })

  it('reads the typed moment on this device’s clock and refuses one beyond the tolerated skew (isFutureInstant)', () => {
    expect(localDateTimeOf(now)).toEqual({ date: '2026-11-12', time: '09:30' })
    expect(paidAtOf('2026-11-12', '09:30')).toBe(now.toISOString())
    expect(paidAtOf('2026-02-30', '09:30')).toBeUndefined()
    expect(paidAtOf('2026-11-12', '25:00')).toBeUndefined()
    expect(isFutureInstant(new Date(now.getTime() + PAID_AT_SKEW_MS).toISOString(), now)).toBe(false)
    expect(isFutureInstant(new Date(now.getTime() + PAID_AT_SKEW_MS + 1).toISOString(), now)).toBe(true)
  })

  it('sends no paidAt when received now, the typed instant otherwise, and never a blank text', () => {
    const base = newRecordPaymentForm(makeInvoice(), now)
    expect(buildRecordPaymentInput({ ...base, reference: '  ', payerName: ' خالد ', notes: '' })).toEqual({ amount: 600, method: 'cash', payerName: 'خالد' })
    expect(buildRecordPaymentInput({ ...base, method: 'bank_transfer', receivedNow: false, paidDate: '2026-11-10', paidTime: '14:05', reference: 'TRX-9' })).toEqual({
      amount: 600,
      method: 'bank_transfer',
      paidAt: new Date(2026, 10, 10, 14, 5).toISOString(),
      reference: 'TRX-9',
    })
  })

  it('counts anything typed beyond the defaults as unsaved, and the hidden moment only once it is shown', () => {
    const initial = newRecordPaymentForm(makeInvoice(), now)
    expect(recordPaymentFormHasChanges(initial, { ...initial })).toBe(false)
    expect(recordPaymentFormHasChanges(initial, { ...initial, paidTime: '08:00' })).toBe(false)
    expect(recordPaymentFormHasChanges(initial, { ...initial, receivedNow: false })).toBe(true)
    expect(recordPaymentFormHasChanges(initial, { ...initial, reference: ' x ' })).toBe(true)
    expect(recordPaymentFormHasChanges(initial, { ...initial, amount: 599.99 })).toBe(true)
  })
})
