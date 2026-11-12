// Pure labels of the certificates screens (J-F51): the percent and the band of
// a grade, the student's name as a certificate prints it and the days of a
// certificate. Arabic keeps Latin digits, as users.format.ts does. No React,
// no i18next instance; unit-tested in certificates.format.test.ts.
import type { CertificateGrade } from '../api/certificates'
import type { LocalizedLabel } from '../api/users'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'

const DASH = '—'

function intlLocale(language: Language): string {
  return language === 'ar' ? 'ar-u-nu-latn' : 'en-GB'
}

/** 86.4 → `86.4%`: the server's number, at most two decimals (numeric(5,2)), Latin digits. */
export function formatPercent(percent: number): string {
  if (!Number.isFinite(percent)) return DASH
  return `${Math.round(percent * 100) / 100}%`
}

/** The band of a grade: `جيد جداً (B)`; without a letter the label alone, without a label the letter alone. */
export function bandOf(grade: { label: LocalizedLabel; letter: string | null }, language: Language): string {
  const label = localizedLabel(grade.label, language).trim()
  const letter = grade.letter?.trim() ?? ''
  if (label && letter) return `${label} (${letter})`
  return label || letter || DASH
}

/** The grade on one line: `86.4% — جيد جداً (B)`. */
export function gradeLine(grade: CertificateGrade, language: Language): string {
  const band = bandOf(grade, language)
  return band === DASH ? formatPercent(grade.percent) : `${formatPercent(grade.percent)} — ${band}`
}

/** The student's name as a certificate prints it: the Latin name in English when there is one, else the full name. */
export function printedStudentName(student: { fullName: string; fullNameLatin?: string | null }, language: Language): string {
  const latin = student.fullNameLatin?.trim()
  return language === 'en' && latin ? latin : student.fullName
}

/**
 * A day of a certificate (issued, completed) as a long date in `zone` — the
 * academy's on the print page, so the printed day matches the year of the
 * serial (D-R53); this device's when no zone is given or the zone is unknown.
 */
export function formatCertificateDay(iso: string | null | undefined, language: Language, zone?: string): string {
  if (!iso) return DASH
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'long' }
  try {
    return new Intl.DateTimeFormat(intlLocale(language), zone ? { ...options, timeZone: zone } : options).format(date)
  } catch {
    // An unknown zone (a server newer than this browser's tz data): this device's day rather than nothing.
    return new Intl.DateTimeFormat(intlLocale(language), options).format(date)
  }
}

/** The name in the active language, or null when it equals the other one (the printed name of a snapshot vs. the current name). */
export function differentName(current: LocalizedLabel | string, printed: LocalizedLabel | string, language: Language): string | null {
  const now = typeof current === 'string' ? current : localizedLabel(current, language)
  const then = typeof printed === 'string' ? printed : localizedLabel(printed, language)
  return now.trim() === then.trim() ? null : now
}
