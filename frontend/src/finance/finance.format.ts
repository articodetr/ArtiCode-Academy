// Presentation helpers of the finance screens (MOD-11-T07): money in the
// invoice's currency with Latin digits, the tag colours of the computed states,
// and the names the lists show. No React, no i18next instance — callers pass
// `t` where a text is needed.
import type { FeePlan, FeePlanShare } from '../api/feePlans'
import type { InstallmentStatus, InvoiceStatus, PaymentState } from '../api/invoices'
import type { PaymentStatus } from '../api/payments'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'

const EMPTY = '—'

const formatters = new Map<string, Intl.NumberFormat>()

function moneyFormatter(language: Language, currency: string | null): Intl.NumberFormat {
  const key = `${language}|${currency ?? ''}`
  let formatter = formatters.get(key)
  if (!formatter) {
    // Arabic with Latin digits, like every number and date on the pages (users.format.ts).
    const locale = language === 'ar' ? 'ar' : 'en-GB'
    const base: Intl.NumberFormatOptions = { numberingSystem: 'latn', minimumFractionDigits: 2, maximumFractionDigits: 2 }
    try {
      formatter = currency ? new Intl.NumberFormat(locale, { ...base, style: 'currency', currency }) : new Intl.NumberFormat(locale, base)
    } catch {
      // An unknown currency code: the amount alone (the caller appends the code).
      formatter = new Intl.NumberFormat(locale, base)
    }
    formatters.set(key, formatter)
  }
  return formatter
}

function knowsCurrency(currency: string): boolean {
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency })
    return true
  } catch {
    return false
  }
}

/**
 * An amount as the server sent it, in `currency` (ISO 4217), two decimals and
 * Latin digits; without a currency (a fee plan before the academy is read) the
 * amount alone. Never rounds anything the server did not.
 */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined, language: Language): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return EMPTY
  const code = currency?.trim() || null
  const text = moneyFormatter(language, code).format(amount)
  return code && !knowsCurrency(code) ? `${text} ${code}` : text
}

/** A share of a plan as `50%` (two decimals at most, Latin digits). */
export function formatPercent(percent: number): string {
  return `${Number(percent.toFixed(2))}%`
}

/** Tag colours of the stored invoice statuses (D-R61). */
export const INVOICE_STATUS_COLORS: Readonly<Record<InvoiceStatus, string>> = {
  draft: 'default',
  issued: 'blue',
  cancelled: 'red',
}

/** Tag colours of the computed payment state of an invoice (D-R62). */
export const PAYMENT_STATE_COLORS: Readonly<Record<PaymentState, string>> = {
  unpaid: 'gold',
  partial: 'processing',
  paid: 'green',
}

/** Tag colours of the computed installment status (D-R62). */
export const INSTALLMENT_STATUS_COLORS: Readonly<Record<InstallmentStatus, string>> = {
  unpaid: 'default',
  partial: 'processing',
  paid: 'green',
}

/** Tag colours of a payment (D-R63): a reversed one stays on record. */
export const PAYMENT_STATUS_COLORS: Readonly<Record<PaymentStatus, string>> = {
  completed: 'green',
  reversed: 'volcano',
}

/** The invoice's number, or null for a draft (the screens then say «draft»). */
export function invoiceNumberOf(invoice: { number: string | null }): string | null {
  return invoice.number?.trim() || null
}

/** What a fee plan prices: its class, else its course, else nothing in particular. */
export type FeePlanScope = 'class' | 'course' | 'general'

export function feePlanScopeOf(plan: Pick<FeePlan, 'course' | 'class'>): FeePlanScope {
  if (plan.class) return 'class'
  if (plan.course) return 'course'
  return 'general'
}

/** `CODE — name` of the course or the class a plan prices, or null for a general plan. */
export function feePlanTargetLabel(plan: Pick<FeePlan, 'course' | 'class'>, language: Language): string | null {
  const target = plan.class ?? plan.course
  return target ? `${target.code} — ${localizedLabel(target.name, language)}` : null
}

/** The shares of a plan, e.g. `50% (+0) · 50% (+30)`: each percent and its due offset in days. */
export function sharesSummary(shares: readonly FeePlanShare[]): string {
  return shares.map((share) => `${formatPercent(share.percent)} (+${share.dueOffsetDays})`).join(' · ')
}
