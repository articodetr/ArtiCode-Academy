// Pure labels of the assignment screens (J-F38): instants formatted in a given
// IANA zone (an assignment's `timeZone` — D-R41), the title in the active
// language and the «submitted / total» ratio of the prototype. Arabic keeps
// Latin digits, as users.format.ts does. No React, no i18next instance.
import type { Assignment } from '../api/assignments'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'

function intlLocale(language: Language): string {
  return language === 'ar' ? 'ar-u-nu-latn' : 'en-GB'
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(language: Language, zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${language}|${zone}|${JSON.stringify(options)}`
  let value = formatters.get(key)
  if (!value) {
    value = new Intl.DateTimeFormat(intlLocale(language), { ...options, timeZone: zone })
    formatters.set(key, value)
  }
  return value
}

function format(iso: string, zone: string, language: Language, options: Intl.DateTimeFormatOptions): string {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return iso
  try {
    return formatter(language, zone, options).format(value)
  } catch {
    // An unknown zone (a server newer than this browser's tz data): the browser's own zone rather than nothing.
    return new Intl.DateTimeFormat(intlLocale(language), options).format(value)
  }
}

/** Date and time of an instant in `zone` (medium date, short time) — the due date and the other instants of an assignment. */
export function formatZonedDateTime(iso: string, zone: string, language: Language): string {
  return format(iso, zone, language, { dateStyle: 'medium', timeStyle: 'short' })
}

/** The calendar day of an instant in `zone` (medium date) — a lesson in the lesson select. */
export function formatZonedDay(iso: string, zone: string, language: Language): string {
  return format(iso, zone, language, { dateStyle: 'medium' })
}

/** The assignment's title in the active language (the mandatory Arabic as the fallback). */
export function assignmentTitle(assignment: Pick<Assignment, 'title'>, language: Language): string {
  return localizedLabel(assignment.title, language)
}

/** `14 / 18`: students with a submission out of the class's active enrollments (the prototype's «submitted / total»). */
export function submissionsRatio(assignment: Pick<Assignment, 'submissions' | 'activeStudents'>): string {
  return `${assignment.submissions.students} / ${assignment.activeStudents}`
}
