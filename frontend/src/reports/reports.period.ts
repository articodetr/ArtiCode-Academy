// The local mirror of a report's rules before a request (MOD-13-T06 — J-F53):
// the period of `resolvePeriod()` (backend/src/reports/reports.period.ts — keep
// them in sync) and the two thresholds of AttendanceStudentsQueryDto
// (backend/src/reports/attendance-reports.dto.ts). A value the server would
// refuse stays on its field with its message and sends nothing. Pure;
// unit-tested in reports.period.test.ts.
import { REPORT_DEFAULT_PERIOD_DAYS, REPORT_MAX_PERIOD_DAYS } from '../api/reports'
import type { ReportPeriod } from '../api/reports'
import { addDays, isCalendarDate } from '../timetable/timetable.dates'
import type { ReportDefinition, ReportFilters } from './reports.catalog'

const DAY_MS = 86_400_000

/** Inclusive days from `from` to `to` (1 for the same day; 0 or less when `to` precedes `from`) — `inclusiveDays()` of the server. */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1
}

/**
 * The period the server will read: an absent `to` is today in the academy's
 * zone, an absent `from` the day that makes a 30-day period with `to` (even
 * when only `from` is absent). Null when `to` is absent and today is unknown
 * (the academy could not be read) — the server then decides alone.
 */
export function resolvedPeriod(filters: Pick<ReportFilters, 'from' | 'to'>, today: string | null): ReportPeriod | null {
  const to = filters.to ?? today
  if (!to) return null
  return { from: filters.from ?? addDays(to, -(REPORT_DEFAULT_PERIOD_DAYS - 1)), to }
}

/** `order`: the first day comes after the last; `tooLong`: more than REPORT_MAX_PERIOD_DAYS inclusive days. */
export type PeriodIssue = 'order' | 'tooLong'

/** The verdict of `resolvePeriod()` on the period these filters make, or null when the server would accept it (or the mirror cannot tell). */
export function periodIssue(filters: Pick<ReportFilters, 'from' | 'to'>, today: string | null): PeriodIssue | null {
  const period = resolvedPeriod(filters, today)
  if (!period || !isCalendarDate(period.from) || !isCalendarDate(period.to)) return null
  const days = inclusiveDays(period.from, period.to)
  if (days < 1) return 'order'
  return days > REPORT_MAX_PERIOD_DAYS ? 'tooLong' : null
}

/** `minAbsences`: an integer of at least 1 (`@IsInt() @Min(1)`). */
export function isValidMinAbsences(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

/** `minAbsenceRate`: 0..100 with at most two decimals (`IsDecimalNumber(2)` — `hasAtMostDecimals()` of common/decimal-number.ts). */
export function isValidMinAbsenceRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number(value.toFixed(2)) === value && value >= 0 && value <= 100
}

/** What keeps a report's request back, by filter; empty when it may be sent. */
export interface ReportFilterIssues {
  period?: PeriodIssue
  minAbsences?: true
  minAbsenceRate?: true
}

export function reportFilterIssues(report: ReportDefinition, filters: ReportFilters, today: string | null): ReportFilterIssues {
  const issues: ReportFilterIssues = {}
  if (report.filters.includes('period')) {
    const issue = periodIssue(filters, today)
    if (issue) issues.period = issue
  }
  if (report.filters.includes('minAbsences') && filters.minAbsences !== undefined && !isValidMinAbsences(filters.minAbsences)) issues.minAbsences = true
  if (report.filters.includes('minAbsenceRate') && filters.minAbsenceRate !== undefined && !isValidMinAbsenceRate(filters.minAbsenceRate)) issues.minAbsenceRate = true
  return issues
}

export function hasFilterIssues(issues: ReportFilterIssues): boolean {
  return Object.keys(issues).length > 0
}
