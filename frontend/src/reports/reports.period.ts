// The report period (D-R69) as the reports page holds it: two calendar days of the academy's zone, both
// inclusive. A manual mirror of resolvePeriod() in backend/src/reports/reports.period.ts and of
// DEFAULT_PERIOD_DAYS / MAX_PERIOD_DAYS in reports.policy.ts — keep them in sync. The page checks the range
// before any request, so a refused range never reaches the server; the server still answers
// `400 report_range_invalid` (reports.errors.ts) if it ever does.
import type { ReportPeriod } from '../api/reports'
import { addDays, isCalendarDate } from '../timetable/timetable.dates'

export const DEFAULT_PERIOD_DAYS = 30
export const MAX_PERIOD_DAYS = 366

/** The last 30 days ending `today` (the academy's day). */
export function defaultPeriod(today: string): ReportPeriod {
  return { from: addDays(today, -(DEFAULT_PERIOD_DAYS - 1)), to: today }
}

/** Days from `from` to `to`, both counted; 0 or less when `to` comes first. */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

export type PeriodProblem = 'missing' | 'order' | 'tooLong'

/** Why the server would refuse a period, or null when it is valid. */
export function periodProblem(period: { from: string; to: string }): PeriodProblem | null {
  if (!isCalendarDate(period.from) || !isCalendarDate(period.to)) return 'missing'
  const days = inclusiveDays(period.from, period.to)
  if (days < 1) return 'order'
  if (days > MAX_PERIOD_DAYS) return 'tooLong'
  return null
}

/** The calendar months `YYYY-MM` a period touches, oldest first. */
export function monthsOf(period: ReportPeriod): string[] {
  const [fromYear, fromMonth] = period.from.split('-').map(Number)
  const [toYear, toMonth] = period.to.split('-').map(Number)
  const months: string[] = []
  for (let index = fromYear * 12 + fromMonth - 1; index <= toYear * 12 + toMonth - 1; index += 1) {
    months.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`)
  }
  return months
}
