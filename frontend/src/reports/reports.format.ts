// Presentation helpers of the reports page: numbers and percentages with Latin digits, names in the UI language.
import type { LocalizedLabel } from '../api/users'
import type { ReportStudentRef } from '../api/reports'
import { labelIn } from '../dashboard/dashboard.data'

/** Below this attendance rate a class or a student needs attention (chalk yellow). */
export const LOW_ATTENDANCE_RATE = 75

function localeOf(language: string): string {
  return language === 'ar' ? 'ar-u-nu-latn' : language
}

export function formatNumber(value: number | null | undefined, language: string): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat(localeOf(language), { maximumFractionDigits: 2 }).format(value)
}

/** A server percentage 0..100 as `87.5%`; `—` when the server sent null (nothing to measure). */
export function formatPercent(value: number | null | undefined, language: string): string {
  return value === null || value === undefined ? '—' : `${formatNumber(value, language)}%`
}

/** `YYYY-MM` as a month name and year. */
export function formatMonth(month: string, language: string): string {
  return new Intl.DateTimeFormat(localeOf(language), { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`))
}

export function studentName(student: ReportStudentRef): string {
  return student.displayName?.trim() || student.fullName
}

/** A class or course as «name (CODE)» for a CSV cell. */
export function namedCode(ref: { code: string; name: LocalizedLabel }, language: string): string {
  return `${labelIn(ref.name, language)} (${ref.code})`
}
