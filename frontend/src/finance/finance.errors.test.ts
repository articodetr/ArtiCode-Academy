import i18n from 'i18next'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { ar } from '../i18n/ar'
import { describeFinanceFailure, failureMessage, failureTitle, isFinanceFailure, problemTexts } from './finance.errors'

const t = i18n.t.bind(i18n)

function apiError(status: number, body: Record<string, unknown>) {
  return new ApiError(status, typeof body.message === 'string' ? body.message : 'error', { statusCode: status, ...body })
}

/** The 20 codes of backend/src/finance/finance.errors.ts (FINANCE_ERROR_CODES), in their order. */
const FINANCE_ERROR_CODES = [
  'fee_plan_not_found',
  'fee_plan_invalid',
  'fee_plan_in_use',
  'fee_plan_inactive',
  'course_not_found',
  'class_not_found',
  'fee_plan_mismatch',
  'invoice_not_found',
  'student_not_found',
  'enrollment_mismatch',
  'invoice_invalid',
  'invoice_not_draft',
  'invoice_not_issued',
  'invoice_has_payments',
  'invalid_transition',
  'payment_exceeds_balance',
  'payment_not_found',
  'payment_reversed',
  'nothing_to_update',
  'cursor_invalid',
] as const

describe('describeFinanceFailure', () => {
  it('words every code of the MOD-11 dictionary in both languages', () => {
    for (const code of [...FINANCE_ERROR_CODES, 'academy_not_configured', 'permission_denied', 'origin_forbidden', 'rate_limited']) {
      const failure = describeFinanceFailure(apiError(400, { code, message: 'x' }))
      expect(failure.key).toBe(`finance.errors.${code}`)
      expect(isFinanceFailure(failure, code)).toBe(true)
      expect(failureMessage(t, failure)).not.toBe(failure.key)
      expect(i18n.getFixedT('en')(failure.key)).not.toBe(failure.key)
    }
  })

  it('words each problem of invoice_invalid on its own, in the server’s order, dropping unknown names', () => {
    const failure = describeFinanceFailure(apiError(400, { code: 'invoice_invalid', problems: ['installment_not_positive', 'nope', 'installments_sum', 'no_lines'] }))
    expect(failure.problems).toEqual(['finance.problems.no_lines', 'finance.problems.installments_sum', 'finance.problems.installment_not_positive'])
    expect(problemTexts(t, failure)).toEqual([ar.finance.problems.no_lines, ar.finance.problems.installments_sum, ar.finance.problems.installment_not_positive])
    expect(failureTitle(t, failure)).toBe(ar.finance.errors.invoice_invalid)
    expect(failureMessage(t, failure)).toBe([ar.finance.errors.invoice_invalid, ar.finance.problems.no_lines, ar.finance.problems.installments_sum, ar.finance.problems.installment_not_positive].join(' '))
  })

  it('words the problems of fee_plan_invalid too', () => {
    const failure = describeFinanceFailure(apiError(400, { code: 'fee_plan_invalid', problems: ['offsets_not_ascending', 'percent_sum'] }))
    expect(problemTexts(t, failure)).toEqual([ar.finance.problems.percent_sum, ar.finance.problems.offsets_not_ascending])
  })

  it('formats the money of payment_exceeds_balance with the caller’s formatter and points at the amount', () => {
    const failure = describeFinanceFailure(apiError(409, { code: 'payment_exceeds_balance', amount: 200.01, balance: 200 }), (amount) => `${amount.toFixed(2)} SAR`)
    expect(failure.field).toEqual(['amount'])
    expect(failure.params).toEqual({ amount: '200.01 SAR', balance: '200.00 SAR' })
    expect(failureMessage(t, failure)).toContain('200.01 SAR')
    expect(failureMessage(t, failure)).toContain('200.00 SAR')
  })

  it('names the count of invoice_has_payments and fee_plan_in_use, and the status the server names in words', () => {
    expect(failureMessage(t, describeFinanceFailure(apiError(409, { code: 'invoice_has_payments', paymentCount: 2 })))).toContain('2')
    expect(failureMessage(t, describeFinanceFailure(apiError(409, { code: 'fee_plan_in_use', invoiceCount: 7 })))).toContain('7')
    const notDraft = failureMessage(t, describeFinanceFailure(apiError(409, { code: 'invoice_not_draft', status: 'issued' })))
    expect(notDraft).toContain(ar.finance.invoiceStatus.issued)
    expect(notDraft).not.toContain('issued')
    expect(failureMessage(t, describeFinanceFailure(apiError(409, { code: 'invalid_transition', from: 'cancelled', action: 'cancel', allowed: [] })))).toContain(ar.finance.invoiceStatus.cancelled)
  })

  it('points the codes at their form fields and lists the missing keys of permission_denied', () => {
    expect(describeFinanceFailure(apiError(404, { code: 'student_not_found' })).field).toEqual(['studentId'])
    expect(describeFinanceFailure(apiError(422, { code: 'enrollment_mismatch' })).field).toEqual(['enrollmentId'])
    expect(describeFinanceFailure(apiError(422, { code: 'fee_plan_mismatch' })).field).toEqual(['feePlanId'])
    expect(describeFinanceFailure(apiError(404, { code: 'course_not_found' })).field).toEqual(['courseId'])
    const denied = describeFinanceFailure(apiError(403, { code: 'permission_denied', missing: ['invoices.read_all', 'invoices.manage', 'payments.record'] }))
    expect(failureMessage(t, denied)).toContain('(invoices.read_all, invoices.manage, payments.record)')
  })

  it('falls back on validation, server and network messages', () => {
    expect(describeFinanceFailure(apiError(400, { message: 'amount must not be greater than 9999999999.99' }))).toEqual({ key: 'finance.errors.validation', params: { message: 'amount must not be greater than 9999999999.99' } })
    expect(describeFinanceFailure(apiError(500, {})).key).toBe('login.errors.server')
    expect(describeFinanceFailure(new TypeError('Failed to fetch')).key).toBe('login.errors.network')
  })
})
