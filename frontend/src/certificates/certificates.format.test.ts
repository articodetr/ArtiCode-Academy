import { describe, expect, it } from 'vitest'
import { bandOf, differentName, formatCertificateDay, formatPercent, gradeLine, printedStudentName } from './certificates.format'

const VERY_GOOD = { percent: 86.4, label: { ar: 'جيد جداً', en: 'Very good' }, letter: 'B' }

describe('certificates.format', () => {
  it('shows the server percent with at most two decimals and Latin digits', () => {
    expect(formatPercent(86.4)).toBe('86.4%')
    expect(formatPercent(90)).toBe('90%')
    expect(formatPercent(66.666)).toBe('66.67%')
    expect(formatPercent(Number.NaN)).toBe('—')
  })

  it('names the band with its letter in the active language, Arabic as the fallback', () => {
    expect(bandOf(VERY_GOOD, 'ar')).toBe('جيد جداً (B)')
    expect(bandOf(VERY_GOOD, 'en')).toBe('Very good (B)')
    expect(bandOf({ label: { ar: 'ممتاز' }, letter: null }, 'en')).toBe('ممتاز')
    expect(bandOf({ label: { ar: '' }, letter: 'A' }, 'ar')).toBe('A')
    expect(bandOf({ label: { ar: ' ' }, letter: null }, 'ar')).toBe('—')
    expect(gradeLine(VERY_GOOD, 'ar')).toBe('86.4% — جيد جداً (B)')
    expect(gradeLine({ ...VERY_GOOD, label: { ar: '' }, letter: null }, 'ar')).toBe('86.4%')
  })

  it('prints the Latin name in English when there is one, the full name otherwise', () => {
    const student = { fullName: 'عمر خالد', fullNameLatin: 'Omar Khaled' }
    expect(printedStudentName(student, 'ar')).toBe('عمر خالد')
    expect(printedStudentName(student, 'en')).toBe('Omar Khaled')
    expect(printedStudentName({ fullName: 'عمر خالد', fullNameLatin: '  ' }, 'en')).toBe('عمر خالد')
    expect(printedStudentName({ fullName: 'عمر خالد' }, 'en')).toBe('عمر خالد')
  })

  it('writes a certificate day as a long date in the given zone — the academy’s day can differ from UTC’s', () => {
    // 2026-12-31 22:30 UTC is already 1 January 2027 in Riyadh (the serial of that certificate carries 2027 — D-R53).
    expect(formatCertificateDay('2026-12-31T22:30:00.000Z', 'en', 'Asia/Riyadh')).toBe('1 January 2027')
    expect(formatCertificateDay('2026-12-31T22:30:00.000Z', 'en', 'UTC')).toBe('31 December 2026')
    expect(formatCertificateDay('2026-12-21T09:30:00.000Z', 'ar', 'Asia/Riyadh')).toBe('21 ديسمبر 2026')
    // An unknown zone falls back to this device's day instead of failing.
    expect(formatCertificateDay('2026-06-15T12:00:00.000Z', 'en', 'Mars/Olympus')).toBe('15 June 2026')
    expect(formatCertificateDay(null, 'ar')).toBe('—')
    expect(formatCertificateDay('not a date', 'ar')).toBe('not a date')
  })

  it('names the current name only when it differs from the printed one', () => {
    expect(differentName({ ar: 'أساسيات بايثون' }, { ar: 'أساسيات بايثون' }, 'ar')).toBeNull()
    expect(differentName({ ar: 'بايثون للمبتدئين' }, { ar: 'أساسيات بايثون' }, 'ar')).toBe('بايثون للمبتدئين')
    expect(differentName('عمر خالد', 'عمر خالد ', 'ar')).toBeNull()
    expect(differentName('عمر خالد العلي', 'عمر خالد', 'ar')).toBe('عمر خالد العلي')
  })
})
