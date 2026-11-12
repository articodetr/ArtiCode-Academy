import { describe, expect, it } from 'vitest'
import { formatLessonDateTime } from '../lessons/lessons.format'
import { formatDay } from '../users/users.format'
import { EMPTY_CELL, csvValueOf, formatAmount, formatCell, formatMoney, formatMonth, formatNumber, formatPercent } from './reports.format'

const AR = { language: 'ar' as const, timeZone: 'Asia/Riyadh' }

describe('reports format', () => {
  it('shows counts and rates as the server sends them, with Latin digits; a null rate (no denominator) is a dash', () => {
    expect(formatNumber(12345, 'ar')).toBe('12,345')
    expect(formatNumber(12.5, 'en')).toBe('12.5')
    expect(formatPercent(87.5, 'ar')).toBe('87.5%')
    expect(formatPercent(100, 'en')).toBe('100%')
    expect(formatPercent(33.33, 'ar')).toBe('33.33%')
    expect(formatPercent(null, 'ar')).toBe(EMPTY_CELL)
    expect(formatNumber(undefined, 'ar')).toBe(EMPTY_CELL)
  })

  it('shows an amount with two decimals and its currency apart', () => {
    expect(formatAmount(31500, 'ar')).toBe('31,500.00')
    expect(formatAmount(4500.5, 'en')).toBe('4,500.50')
    expect(formatMoney(200, 'USD', 'ar')).toBe('200.00 USD')
  })

  it('names a month of the academy calendar in the UI language', () => {
    expect(formatMonth('2026-11', 'en')).toBe('November 2026')
    expect(formatMonth('2026-11', 'ar')).toBe('نوفمبر 2026')
    expect(formatMonth('2026-13x', 'ar')).toBe('2026-13x')
    expect(formatMonth(null, 'ar')).toBe(EMPTY_CELL)
  })

  it('formats a cell by its column kind; instants on the wall clock of the report zone', () => {
    expect(formatCell('count', 1200, AR)).toBe('1,200')
    expect(formatCell('percent', 90, AR)).toBe('90%')
    expect(formatCell('amount', 9000, AR)).toBe('9,000.00')
    expect(formatCell('day', '2026-09-30', AR)).toBe(formatDay('2026-09-30', 'ar'))
    expect(formatCell('instant', '2026-11-05T17:00:00.000Z', AR)).toBe(formatLessonDateTime('2026-11-05T17:00:00.000Z', 'ar', 'Asia/Riyadh'))
    expect(formatCell('text', 'ENG-A1', AR)).toBe('ENG-A1')
    expect(formatCell('percent', null, AR)).toBe(EMPTY_CELL)
    expect(formatCell('text', '', AR)).toBe(EMPTY_CELL)
  })

  it('exports numbers unformatted, days and months as the API gives them, instants as the zone wall clock, nothing as empty', () => {
    expect(csvValueOf('amount', 31500.5, 'Asia/Riyadh')).toBe(31500.5)
    expect(csvValueOf('percent', 87.5, 'Asia/Riyadh')).toBe(87.5)
    expect(csvValueOf('month', '2026-11', 'Asia/Riyadh')).toBe('2026-11')
    expect(csvValueOf('day', '2026-09-30', 'Asia/Riyadh')).toBe('2026-09-30')
    // 17:00Z is 20:00 in Riyadh (UTC+3) — the report zone, never the browser's.
    expect(csvValueOf('instant', '2026-11-05T17:00:00.000Z', 'Asia/Riyadh')).toBe('2026-11-05 20:00')
    expect(csvValueOf('instant', '2026-11-05T22:30:00.000Z', 'Asia/Riyadh')).toBe('2026-11-06 01:30')
    expect(csvValueOf('percent', null, 'Asia/Riyadh')).toBe('')
  })
})
