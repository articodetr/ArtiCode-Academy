import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { describePaymentsFailure, isStaleInvoice } from './payments.errors'
import { buildRecordPaymentInput, exceeds, isFutureInstant, isTwoDecimalAmount, paymentsViewOf } from './payments.format'

describe('payments helpers', () => {
  it('picks the office view for any office key, else «my invoices»', () => {
    const holds = (keys: string[]) => (key: string) => keys.includes(key)
    expect(paymentsViewOf(holds(['payments.record']))).toBe('office')
    expect(paymentsViewOf(holds(['invoices.read_own', 'invoices.read_all']))).toBe('office')
    expect(paymentsViewOf(holds(['invoices.read_linked']))).toBe('learner')
    expect(paymentsViewOf(holds(['payments.refund']))).toBe('none')
  })

  it('builds the API-151 body without blank texts or a blank moment', () => {
    expect(buildRecordPaymentInput({ amount: 10.5, method: 'card', paidAt: '', reference: '  ', notes: ' n ' })).toEqual({ amount: 10.5, method: 'card', notes: 'n' })
    const withMoment = buildRecordPaymentInput({ amount: 1, paidAt: '2026-11-14T09:30' })
    expect(withMoment.method).toBe('cash')
    expect(withMoment.paidAt).toMatch(/^2026-11-1\dT\d{2}:30:00\.000Z$/)
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
    expect(isStaleInvoice(exceeded)).toBe(true)
    expect(describePaymentsFailure(new ApiError(403, 'no', { code: 'permission_denied', missing: ['payments.refund'] }))).toEqual({
      key: 'payments.errors.permission_denied',
      params: { list: '(payments.refund)' },
    })
    expect(describePaymentsFailure(new TypeError('offline'))).toEqual({ key: 'login.errors.network' })
  })
})
