// Pure helpers shared by the dashboard homes, the payments and the reports screens: the day of an instant in a
// zone, money as the academy writes it, and a server label in the UI language.
// No request and no React here — dashboard.data.test.ts covers them.
import type { LocalizedLabel } from '../api/users'
import { wallClockIn } from '../common/timeZone'

/** The calendar day of an instant in `zone`, `YYYY-MM-DD`. */
export function wallDate(iso: string, zone: string): string {
  return wallClockIn(iso, zone).date
}

/**
 * Money as the academy writes it, with the currency symbol and always two decimals (the API's amounts are two-decimal
 * values), so 325 never stands beside 162.50 on one screen. In Arabic, Intl writes a right-to-left mark before a
 * left-to-right amount that ends in a neutral `$`, which a right-to-left line shows as «$US 150.00»: the amount is
 * written as one left-to-right isolate instead, so it reads the same in a sentence, a table cell or a `<bdi>`.
 */
export function formatMoney(amount: number, currency: string, language: string): string {
  let text: string
  try {
    text = new Intl.NumberFormat(language === 'ar' ? 'ar-u-nu-latn' : language, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
  } catch {
    text = `${amount.toFixed(2)} ${currency}`
  }
  return language === 'ar' ? `⁦${text.replaceAll('‏', '')}⁩` : text
}

/** A server label in the UI language, the Arabic text when that language is missing. */
export function labelIn(text: LocalizedLabel, language: string): string {
  return (language === 'en' ? text.en : language === 'tr' ? text.tr : undefined) || text.ar
}
