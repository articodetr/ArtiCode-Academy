import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { describePaymentsFailure, isStaleInvoice } from './payments.errors'
import { buildRecordPaymentInput, exceeds, formatMoney, instantOfLocal, isFutureInstant, isTwoDecimalAmount, paymentsViewOf } from './payments.format'

describe('payments helpers', () => {
  it('picks the office view for any office key, else «my invoices»', () => {
    const holds = (keys: string[]) => (key: string) => keys.includes(key)
    expect(paymentsViewOf(holds(['payments.record']))).toBe('office')
    expect(paymentsViewOf(holds(['invoices.read_own', 'invoices.read_all']))).toBe('office')
    expect(paymentsViewOf(holds(['invoices.read_linked']))).toBe('learner')
    expect(paymentsViewOf(holds(['payments.refund']))).toBe('none')
  })

  it('builds the API-151 body without blank texts or a blank moment', () => {
    expect(buildRecordPaymentInput({ amount: 10.5, method: 'card', paidAt: '', reference: '  ', notes: ' n ' }, 'Asia/Riyadh')).toEqual({ amount: 10.5, method: 'card', notes: 'n' })
    const withMoment = buildRecordPaymentInput({ amount: 1, paidAt: '2026-11-14T09:30' }, 'Asia/Riyadh')
    expect(withMoment.method).toBe('cash')
    expect(withMoment.paidAt).toBe('2026-11-14T06:30:00.000Z')
  })

  it('reads the typed moment as the wall clock of the given zone, never this device’s (QA V4 P6: London typed 10:00 for a Riyadh academy)', () => {
    // Two zones, two instants: a conversion that ignores the zone can match one of them at most.
    expect(instantOfLocal('2026-11-14T10:00', 'Asia/Riyadh')).toBe('2026-11-14T07:00:00.000Z')
    expect(instantOfLocal('2026-11-14T10:00', 'Asia/Tokyo')).toBe('2026-11-14T01:00:00.000Z')
    expect(instantOfLocal('2026-11-14T10:00', 'Europe/London')).toBe('2026-11-14T10:00:00.000Z')
    expect(instantOfLocal('2026-11-14T10:00:30', 'Asia/Riyadh')).toBe('2026-11-14T07:00:00.000Z')
    expect(instantOfLocal('', 'Asia/Riyadh')).toBeUndefined()
    expect(instantOfLocal(undefined, 'Asia/Riyadh')).toBeUndefined()
    expect(instantOfLocal('2026-13-40T10:00', 'Asia/Riyadh')).toBeUndefined()
    expect(instantOfLocal('not a time', 'Asia/Riyadh')).toBeUndefined()
  })

  it('mirrors the amount and moment rules', () => {
    expect(isTwoDecimalAmount(12.34)).toBe(true)
    expect(isTwoDecimalAmount(12.345)).toBe(false)
    expect(isTwoDecimalAmount(1e-7)).toBe(false)
    expect(exceeds(0.1 + 0.2, 0.3)).toBe(false)
    expect(exceeds(400.01, 400)).toBe(true)
    const now = new Date('2026-11-14T10:00:00Z')
    expect(isFutureInstant('2026-11-14T10:04:00Z', now)).toBe(false)
    expect(isFutureInstant('2026-11-14T10:06:00Z', now)).toBe(true)
  })

  it('maps the finance codes with their details', () => {
    const exceeded = new ApiError(409, 'above', { code: 'payment_exceeds_balance', amount: 600, balance: 400 })
    expect(describePaymentsFailure(exceeded)).toEqual({ key: 'payments.errors.payment_exceeds_balance', field: ['amount'], params: { amount: '600', balance: '400' } })
    // With the invoice's currency the details are money, as every amount on the screen (QA V4 P3: «550.25 / 500.25»).
    expect(describePaymentsFailure(exceeded, (amount) => formatMoney(amount, 'SAR', 'en')).params).toEqual({ amount: formatMoney(600, 'SAR', 'en'), balance: formatMoney(400, 'SAR', 'en') })
    expect(describePaymentsFailure(new ApiError(409, 'paid', { code: 'invoice_has_payments', paymentCount: 2 }), (amount) => `M${amount}`).params).toEqual({ paymentCount: '2' })
    expect(isStaleInvoice(exceeded)).toBe(true)
    expect(describePaymentsFailure(new ApiError(403, 'no', { code: 'permission_denied', missing: ['payments.refund'] }))).toEqual({
      key: 'payments.errors.permission_denied',
      params: { list: '(payments.refund)' },
    })
    expect(describePaymentsFailure(new TypeError('offline'))).toEqual({ key: 'login.errors.network' })
  })
})
