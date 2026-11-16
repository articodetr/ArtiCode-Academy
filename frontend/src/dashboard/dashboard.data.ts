// Pure helpers shared by the dashboard homes, the payments and the reports screens: the day of an instant in a
// zone, money as the academy writes it, and a server label in the UI language.
// No request and no React here — dashboard.data.test.ts covers them.
import type { LocalizedLabel } from '../api/users'
import { wallClockIn } from '../common/timeZone'

/** The calendar day of an instant in `zone`, `YYYY-MM-DD`. */
export function wallDate(iso: string, zone: string): string {
  return wallClockIn(iso, zone).date
}

/** Money as the academy writes it, with the currency symbol and no more than two decimals. */
export function formatMoney(amount: number, currency: string, language: string): string {
  try {
    return new Intl.NumberFormat(language === 'ar' ? 'ar-u-nu-latn' : language, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

/** A server label in the UI language, the Arabic text when that language is missing. */
export function labelIn(text: LocalizedLabel, language: string): string {
  return (language === 'en' ? text.en : language === 'tr' ? text.tr : undefined) || text.ar
}
