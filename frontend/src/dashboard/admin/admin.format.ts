// Number formats of the admin home (J-F59): Latin digits in every language, as the rest of the app writes numbers.
// No request and no React here — admin.format.test.ts covers them.
import type { CalendarDate } from '../../timetable/timetable.dates'

function locale(language: string): string {
  return language === 'ar' ? 'ar-u-nu-latn' : language
}

/** A count as the UI language writes it (Latin digits, grouped). */
export function formatCount(value: number, language: string): string {
  return new Intl.NumberFormat(locale(language)).format(value)
}

/** A rate the server sends as a percentage (0–100, e.g. 87.5) — at most one decimal. */
export function formatRate(percent: number, language: string): string {
  return new Intl.NumberFormat(locale(language), { style: 'percent', maximumFractionDigits: 1 }).format(percent / 100)
}

/** A calendar day as a long heading («الأحد، 22 نوفمبر 2026»); the day itself, never shifted by a zone. */
export function formatDayHeading(date: CalendarDate, language: string, withYear = false): string {
  return new Intl.DateTimeFormat(locale(language), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`))
}
