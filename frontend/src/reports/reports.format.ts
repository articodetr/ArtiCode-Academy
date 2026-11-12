// How the reports screens show a value (MOD-13-T06 — J-F53): the server's
// numbers as they are, only presented — counts and amounts with Latin digits
// and grouping, rates with a % sign, a null rate as a dash (D-R70: null when the
// denominator is zero), calendar days and months localized, instants on the
// wall clock of the report's zone (the academy's — D-R69). And how the same
// value goes into a CSV cell: numbers unformatted, days and months as the API
// gives them, an instant as `YYYY-MM-DD HH:MM` in the report's zone (D-R71).
// No React, no i18next instance; unit-tested in reports.format.test.ts.
import type { Language } from '../i18n/language'
import { formatLessonDateTime, zonedPartsOf } from '../lessons/lessons.format'
import { formatDay } from '../users/users.format'

export const EMPTY_CELL = '—'

/** What a column holds, which decides how a value is shown and exported. */
export type ColumnKind = 'text' | 'count' | 'percent' | 'amount' | 'score' | 'day' | 'month' | 'instant'

/** A cell as the report gives it: a number, a text (or a day, month or ISO instant) or nothing. */
export type CellValue = string | number | null

export interface FormatContext {
  language: Language
  /** The report's zone (its `timeZone`): the wall clock of every instant. */
  timeZone: string
}

function intlLocale(language: Language): string {
  // Arabic with Latin digits, as users.format.ts: numbers line up with the codes around them.
  return language === 'ar' ? 'ar-u-nu-latn' : 'en-GB'
}

const numberFormats = new Map<string, Intl.NumberFormat>()

function numberFormat(language: Language, minimumFractionDigits: number, maximumFractionDigits: number): Intl.NumberFormat {
  const key = `${language}|${minimumFractionDigits}|${maximumFractionDigits}`
  let format = numberFormats.get(key)
  if (!format) {
    format = new Intl.NumberFormat(intlLocale(language), { minimumFractionDigits, maximumFractionDigits })
    numberFormats.set(key, format)
  }
  return format
}

/** A count or a score: grouped, up to two decimals (the server never sends more). */
export function formatNumber(value: number | null | undefined, language: Language): string {
  return typeof value === 'number' && Number.isFinite(value) ? numberFormat(language, 0, 2).format(value) : EMPTY_CELL
}

/** A rate in % (two decimals at most, as the server rounds it); null — no denominator — is a dash. */
export function formatPercent(value: number | null | undefined, language: Language): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${numberFormat(language, 0, 2).format(value)}%` : EMPTY_CELL
}

/** An amount: always two decimals, as the MOD-11 contracts send it; the currency is its own column. */
export function formatAmount(value: number | null | undefined, language: Language): string {
  return typeof value === 'number' && Number.isFinite(value) ? numberFormat(language, 2, 2).format(value) : EMPTY_CELL
}

/** An amount with its currency code, e.g. `1,500.00 SAR` (the dashboard's tiles). */
export function formatMoney(value: number, currency: string, language: Language): string {
  return `${formatAmount(value, language)} ${currency}`
}

const MONTH = /^(\d{4})-(\d{2})$/
const monthFormats = new Map<Language, Intl.DateTimeFormat>()

/** `YYYY-MM` (a month of the academy's calendar) → «نوفمبر 2026» / «November 2026». */
export function formatMonth(value: string | null | undefined, language: Language): string {
  if (!value) return EMPTY_CELL
  const match = MONTH.exec(value)
  if (!match) return value
  let format = monthFormats.get(language)
  if (!format) {
    format = new Intl.DateTimeFormat(intlLocale(language), { year: 'numeric', month: 'long', timeZone: 'UTC' })
    monthFormats.set(language, format)
  }
  return format.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)))
}

/** A cell as the table shows it. */
export function formatCell(kind: ColumnKind, value: CellValue, context: FormatContext): string {
  if (value === null || value === '') return EMPTY_CELL
  switch (kind) {
    case 'count':
    case 'score':
      return typeof value === 'number' ? formatNumber(value, context.language) : value
    case 'percent':
      return typeof value === 'number' ? formatPercent(value, context.language) : value
    case 'amount':
      return typeof value === 'number' ? formatAmount(value, context.language) : value
    case 'day':
      return typeof value === 'string' ? formatDay(value, context.language) : String(value)
    case 'month':
      return typeof value === 'string' ? formatMonth(value, context.language) : String(value)
    case 'instant':
      return typeof value === 'string' ? formatLessonDateTime(value, context.language, context.timeZone) : String(value)
    case 'text':
      return String(value)
  }
}

/** True for the kinds whose cells are numbers (shown and exported as such). */
export function isNumericKind(kind: ColumnKind): boolean {
  return kind === 'count' || kind === 'percent' || kind === 'amount' || kind === 'score'
}

/**
 * A cell as the CSV holds it: a number unformatted (no grouping, a dot, no %),
 * a day or a month as the API gives it, an instant as `YYYY-MM-DD HH:MM` on the
 * report zone's wall clock, a text as shown; nothing is an empty cell.
 */
export function csvValueOf(kind: ColumnKind, value: CellValue, timeZone: string): string | number {
  if (value === null) return ''
  if (kind === 'instant' && typeof value === 'string') {
    const parts = zonedPartsOf(value, timeZone)
    return parts.date ? `${parts.date} ${parts.time}` : value
  }
  return value
}
