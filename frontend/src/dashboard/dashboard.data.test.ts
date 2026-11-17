import { describe, expect, it } from 'vitest'
import { formatMoney, labelIn, wallDate } from './dashboard.data'

describe('dashboard formats', () => {
  it('formats money with two decimals, whole amounts too (QA V4: «325 ر.س.» stood beside «162.50 ر.س.»)', () => {
    expect(formatMoney(38400, 'TRY', 'en')).toBe('₺38,400.00')
    expect(formatMoney(12.5, 'USD', 'en')).toBe('$12.50')
    expect(formatMoney(100, 'SAR', 'en')).toMatch(/^SAR\s100\.00$/)
    expect(formatMoney(325, 'SAR', 'ar')).toContain('325.00')
    expect(formatMoney(162.5, 'SAR', 'ar')).toContain('162.50')
  })

  it('writes money with Latin digits in Arabic and falls back to the code for an unknown currency', () => {
    expect(formatMoney(1500, 'TRY', 'ar')).toMatch(/1,?500\.00/)
    expect(formatMoney(7, 'NOT-A-CURRENCY', 'en')).toBe('7.00 NOT-A-CURRENCY')
  })

  it('reads a server label in the UI language, the Arabic text when that language is missing', () => {
    expect(labelIn({ ar: 'عربي', en: 'English' }, 'en')).toBe('English')
    expect(labelIn({ ar: 'عربي' }, 'en')).toBe('عربي')
  })

  it('names the calendar day of an instant in the given zone', () => {
    expect(wallDate('2026-11-14T22:30:00.000Z', 'Europe/Istanbul')).toBe('2026-11-15')
    expect(wallDate('2026-11-14T22:30:00.000Z', 'UTC')).toBe('2026-11-14')
  })
})
