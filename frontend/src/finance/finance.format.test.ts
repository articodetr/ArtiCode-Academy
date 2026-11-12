import { describe, expect, it } from 'vitest'
import { makeCoursePlan, makeFeePlan, makeInactivePlan } from '../test/feePlans'
import { feePlanScopeOf, feePlanTargetLabel, formatMoney, formatPercent, invoiceNumberOf, sharesSummary } from './finance.format'

describe('finance format', () => {
  it('shows an amount in its currency with two decimals and Latin digits, in both languages', () => {
    const arabic = formatMoney(1500.5, 'SAR', 'ar')
    expect(arabic).toContain('1,500.50')
    expect(arabic).not.toMatch(/[٠-٩]/)
    expect(formatMoney(1500.5, 'SAR', 'en')).toContain('1,500.50')
    expect(formatMoney(1500.5, 'SAR', 'en')).toContain('SAR')
    expect(formatMoney(0, 'USD', 'en')).toContain('0.00')
  })

  it('shows the amount alone without a currency, the code after an unknown one, and a dash without an amount', () => {
    expect(formatMoney(1200, null, 'en')).toBe('1,200.00')
    expect(formatMoney(1200, 'ZZZZ', 'en')).toBe('1,200.00 ZZZZ')
    expect(formatMoney(null, 'SAR', 'ar')).toBe('—')
    expect(formatMoney(Number.NaN, 'SAR', 'ar')).toBe('—')
  })

  it('names a plan’s scope and target, and its shares with their due offsets', () => {
    expect(feePlanScopeOf(makeFeePlan())).toBe('class')
    expect(feePlanScopeOf(makeCoursePlan())).toBe('course')
    expect(feePlanScopeOf({ course: null, class: null })).toBe('general')
    expect(feePlanTargetLabel(makeFeePlan(), 'en')).toBe('PY-101-A — Python — class A')
    expect(feePlanTargetLabel(makeCoursePlan(), 'ar')).toBe('PY-101 — أساسيات بايثون')
    expect(feePlanTargetLabel({ course: null, class: null }, 'ar')).toBeNull()
    expect(sharesSummary(makeFeePlan().installments)).toBe('50% (+0) · 50% (+30)')
    expect(sharesSummary(makeInactivePlan({ installments: [{ percent: 33.33, dueOffsetDays: 0 }] }).installments)).toBe('33.33% (+0)')
    expect(formatPercent(12.5)).toBe('12.5%')
  })

  it('reads a draft as numberless', () => {
    expect(invoiceNumberOf({ number: 'INV-2026-00057' })).toBe('INV-2026-00057')
    expect(invoiceNumberOf({ number: null })).toBeNull()
    expect(invoiceNumberOf({ number: '  ' })).toBeNull()
  })
})
