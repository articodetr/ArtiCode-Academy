// The «record a payment» form (J-F52 — API-151, D-R63) and the reason forms of
// a cancellation (API-149) and a reversal (API-154): their values, the body
// they send and the server rules they mirror before any request —
// `exceedsBalance()` and `isFutureInstant()` of
// backend/src/finance/payments.rules.ts (keep in sync): the amount is never
// above the balance the server sent with the invoice, and the moment the money
// was received is never more than PAID_AT_SKEW_MS ahead of now. The moment is
// typed on this device's clock (the cashier's — the server tolerates the skew
// of another device's clock); «received now» sends no `paidAt`, so the server
// stamps its own now. No React.
import { PAID_AT_SKEW_MS } from '../api/payments'
import type { PaymentMethod, RecordPaymentInput } from '../api/payments'
import type { InvoiceSummary } from '../api/invoices'
import { isCalendarDate } from '../timetable/timetable.dates'
import { toCents } from './finance.money'

export interface RecordPaymentFormValues {
  amount?: number | null
  method?: PaymentMethod
  /** True: the money was received now — the server stamps the moment. */
  receivedNow?: boolean
  /** `YYYY-MM-DD` and `HH:MM` on this device's clock, when not received now. */
  paidDate?: string
  paidTime?: string
  reference?: string
  payerName?: string
  notes?: string
}

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const text = (value: string | undefined | null) => (value ?? '').trim()
const pad = (value: number) => String(value).padStart(2, '0')

/** This device's calendar day and clock time of `now` — the defaults of the moment fields. */
export function localDateTimeOf(now: Date): { date: string; time: string } {
  return { date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time: `${pad(now.getHours())}:${pad(now.getMinutes())}` }
}

/**
 * The form a new payment starts from: the amount the server says is due next
 * (the first installment not covered), else the whole balance; cash; received now.
 */
export function newRecordPaymentForm(invoice: Pick<InvoiceSummary, 'balance' | 'nextDue'>, now: Date): RecordPaymentFormValues {
  const { date, time } = localDateTimeOf(now)
  const suggested = invoice.nextDue && invoice.nextDue.remaining > 0 && invoice.nextDue.remaining <= invoice.balance ? invoice.nextDue.remaining : invoice.balance
  return { amount: suggested, method: 'cash', receivedNow: true, paidDate: date, paidTime: time, reference: '', payerName: '', notes: '' }
}

/** The moment typed on this device's clock as an ISO 8601 instant, or undefined while incomplete or malformed. */
export function paidAtOf(date: string | undefined, time: string | undefined): string | undefined {
  if (!date || !time || !isCalendarDate(date) || !CLOCK_TIME.test(time)) return undefined
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const [hours, minutes] = time.split(':').map(Number) as [number, number]
  const instant = new Date(year, month - 1, day, hours, minutes)
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString()
}

/** `isFutureInstant()`: true when `at` lies beyond `now` plus the tolerated skew. */
export function isFutureInstant(at: string, now: Date, skewMs: number = PAID_AT_SKEW_MS): boolean {
  return new Date(at).getTime() > now.getTime() + skewMs
}

/** `exceedsBalance()` on the balance the server sent: true when `amount` is above what is left to pay. */
export function exceedsBalance(amount: number, balance: number): boolean {
  return toCents(amount) > toCents(balance)
}

/** Body of API-151: `paidAt` only when not received now; blank texts are absent (the server refuses an empty one). */
export function buildRecordPaymentInput(values: RecordPaymentFormValues): RecordPaymentInput {
  const input: RecordPaymentInput = { amount: values.amount as number, method: values.method ?? 'cash' }
  if (values.receivedNow === false) {
    const paidAt = paidAtOf(values.paidDate, values.paidTime)
    if (paidAt) input.paidAt = paidAt
  }
  if (text(values.reference)) input.reference = text(values.reference)
  if (text(values.payerName)) input.payerName = text(values.payerName)
  if (text(values.notes)) input.notes = text(values.notes)
  return input
}

/** Whether the payment form holds unsaved work: anything typed beyond the defaults it started with. */
export function recordPaymentFormHasChanges(initial: RecordPaymentFormValues, values: RecordPaymentFormValues): boolean {
  const cents = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? toCents(value) : null)
  const shape = (form: RecordPaymentFormValues) =>
    JSON.stringify([
      cents(form.amount),
      form.method ?? null,
      form.receivedNow ?? true,
      form.receivedNow === false ? [form.paidDate ?? '', form.paidTime ?? ''] : null,
      text(form.reference),
      text(form.payerName),
      text(form.notes),
    ])
  return shape(initial) !== shape(values)
}
