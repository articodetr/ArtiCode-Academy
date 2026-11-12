import { describe, expect, it } from 'vitest'
import { reportDefinitionOf } from './reports.catalog'
import { hasFilterIssues, inclusiveDays, isValidMinAbsenceRate, isValidMinAbsences, periodIssue, reportFilterIssues, resolvedPeriod } from './reports.period'

const TODAY = '2026-11-11'

describe('the period mirror of resolvePeriod() (D-R69)', () => {
  it('counts inclusive days as the server does', () => {
    expect(inclusiveDays('2026-11-11', '2026-11-11')).toBe(1)
    expect(inclusiveDays('2026-10-13', '2026-11-11')).toBe(30)
    expect(inclusiveDays('2026-11-12', '2026-11-11')).toBe(0)
    // A daylight-saving change never moves a calendar day.
    expect(inclusiveDays('2026-03-01', '2026-03-31')).toBe(31)
    expect(inclusiveDays('2024-01-01', '2024-12-31')).toBe(366)
  })

  it('reads an absent `to` as today and an absent `from` as the day of a 30-day period — even with only `from` absent', () => {
    expect(resolvedPeriod({}, TODAY)).toEqual({ from: '2026-10-13', to: TODAY })
    expect(resolvedPeriod({ to: '2026-01-31' }, TODAY)).toEqual({ from: '2026-01-02', to: '2026-01-31' })
    expect(resolvedPeriod({ from: '2026-09-01' }, TODAY)).toEqual({ from: '2026-09-01', to: TODAY })
    // Without the academy's today the mirror cannot tell an open-ended period.
    expect(resolvedPeriod({ from: '2026-09-01' }, null)).toBeNull()
    expect(resolvedPeriod({ from: '2026-09-01', to: '2026-09-30' }, null)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })

  it('refuses the first day after the last and more than 366 inclusive days, as report_range_invalid does', () => {
    expect(periodIssue({}, TODAY)).toBeNull()
    expect(periodIssue({ from: '2026-11-12', to: '2026-11-11' }, TODAY)).toBe('order')
    expect(periodIssue({ from: '2025-11-10', to: '2026-11-11' }, TODAY)).toBe('tooLong') // 367 days
    expect(periodIssue({ from: '2025-11-11', to: '2026-11-11' }, TODAY)).toBeNull() // exactly 366
    // `from` alone runs to today: a future `from` is out of order, a far one too long.
    expect(periodIssue({ from: '2026-11-20' }, TODAY)).toBe('order')
    expect(periodIssue({ from: '2024-01-01' }, TODAY)).toBe('tooLong')
    expect(periodIssue({ from: '2026-11-20' }, null)).toBeNull()
    // `to` alone is always 30 days.
    expect(periodIssue({ to: '2020-02-29' }, TODAY)).toBeNull()
  })
})

describe('the absence thresholds of AttendanceStudentsQueryDto', () => {
  it('takes an integer of at least 1 for the absences', () => {
    expect([1, 3, 120].every(isValidMinAbsences)).toBe(true)
    expect([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '3'].some(isValidMinAbsences)).toBe(false)
  })

  it('takes 0..100 with at most two decimals for the rate (the KI-075 rule — no exponent forms)', () => {
    expect([0, 12.5, 33.33, 100].every(isValidMinAbsenceRate)).toBe(true)
    expect([-0.01, 100.01, 12.345, 1e-7, Number.NaN, '20'].some(isValidMinAbsenceRate)).toBe(false)
  })

  it('holds back the request of the report that sends the refused value, and no other', () => {
    const students = reportDefinitionOf('attendance-students')!
    const classes = reportDefinitionOf('attendance-classes')!
    const receivables = reportDefinitionOf('financial-receivables')!
    expect(reportFilterIssues(students, { minAbsences: 0, minAbsenceRate: 12.345 }, TODAY)).toEqual({ minAbsences: true, minAbsenceRate: true })
    expect(reportFilterIssues(classes, { minAbsences: 0 }, TODAY)).toEqual({})
    expect(reportFilterIssues(classes, { from: '2026-12-01', to: '2026-11-01' }, TODAY)).toEqual({ period: 'order' })
    // The receivables send no period at all.
    expect(hasFilterIssues(reportFilterIssues(receivables, { from: '2026-12-01', to: '2026-11-01' }, TODAY))).toBe(false)
  })
})
