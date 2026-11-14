// Display helpers of the payments screens (MOD-11): the money of an invoice in
// its own currency, the tone of each finance status and the permission split of
// the page. Pure — every number shown is the server's (ADR-068); nothing here
// computes a balance.
import { formatMoney } from '../dashboard/dashboard.data'
import type { StatusTone } from '../components/StatusTag'
import type { PaymentMethod } from '../api/invoices'
import type { RecordPaymentInput } from '../api/payments'

export { formatMoney }

/** Any one of these opens the office view (D-R65 — `missingAny()` of finance.policy.ts). */
export const INVOICE_READ_PERMISSIONS = ['invoices.read_all', 'invoices.manage', 'payments.record'] as const
/** Either one opens «my invoices» (API-155). */
export const MY_INVOICES_PERMISSIONS = ['invoices.read_own', 'invoices.read_linked'] as const

export type PaymentsView = 'office' | 'learner' | 'none'

/** The office view wins for a user who holds both kinds of keys. */
export function paymentsViewOf(hasPermission: (key: string) => boolean): PaymentsView {
  if (INVOICE_READ_PERMISSIONS.some(hasPermission)) return 'office'
  if (MY_INVOICES_PERMISSIONS.some(hasPermission)) return 'learner'
  return 'none'
}

/** The tabs of the office view, in order: invoices (any invoice read key), fee plans (`fee_plans.manage` or
 * `invoices.manage` — FEE_PLAN_READ_PERMISSIONS of finance.policy.ts), recorded payments (the invoice read keys,
 * as API-152 checks). */
export const OFFICE_TABS = ['invoices', 'feePlans', 'payments'] as const
export type OfficeTab = (typeof OFFICE_TABS)[number]
export const FEE_PLAN_READ_PERMISSIONS = ['fee_plans.manage', 'invoices.manage'] as const

export function officeTabsOf(hasPermission: (key: string) => boolean): OfficeTab[] {
  if (!INVOICE_READ_PERMISSIONS.some(hasPermission)) return []
  const tabs: OfficeTab[] = ['invoices']
  if (FEE_PLAN_READ_PERMISSIONS.some(hasPermission)) tabs.push('feePlans')
  tabs.push('payments')
  return tabs
}

const TONES: Record<string, StatusTone> = {
  draft: 'neutral',
  issued: 'live',
  cancelled: 'neutral',
  unpaid: 'attention',
  partial: 'attention',
  paid: 'ok',
  completed: 'ok',
  reversed: 'bad',
  overdue: 'bad',
}

export function financeToneOf(value: string): StatusTone {
  return TONES[value] ?? 'neutral'
}

/** The person as the finance DTOs name them: the display name when set, else the full name. */
export function personName(person: { fullName: string; displayName: string | null }): string {
  return person.displayName?.trim() || person.fullName
}

/** `datetime-local` value (this device's clock) → ISO instant, or undefined when blank or malformed. */
export function instantOfLocal(value: string | undefined): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** `isFutureInstant()` of backend/src/finance/payments.rules.ts — the server tolerates 5 minutes of clock skew. */
export const PAID_AT_SKEW_MS = 5 * 60 * 1000
export function isFutureInstant(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() > now.getTime() + PAID_AT_SKEW_MS
}

/** A JSON number with at most two decimals (the DTOs' `IsDecimalNumber(2)`), no exponent form. */
export function isTwoDecimalAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && /^\d+(\.\d{1,2})?$/.test(String(value))
}

/** Compares two-decimal amounts in cents, so 0.1 + 0.2 never decides a limit. */
export function exceeds(amount: number, limit: number): boolean {
  return Math.round(amount * 100) > Math.round(limit * 100)
}

export interface RecordPaymentFormValues {
  amount?: number | null
  method?: PaymentMethod
  paidAt?: string
  reference?: string
  payerName?: string
  notes?: string
}

const trimmed = (value: string | undefined) => (value ?? '').trim()

/** Body of API-151: blank texts and a blank moment stay absent (the server refuses an empty string). */
export function buildRecordPaymentInput(values: RecordPaymentFormValues): RecordPaymentInput {
  const input: RecordPaymentInput = { amount: values.amount as number, method: values.method ?? 'cash' }
  const paidAt = instantOfLocal(values.paidAt)
  if (paidAt) input.paidAt = paidAt
  if (trimmed(values.reference)) input.reference = trimmed(values.reference)
  if (trimmed(values.payerName)) input.payerName = trimmed(values.payerName)
  if (trimmed(values.notes)) input.notes = trimmed(values.notes)
  return input
}
