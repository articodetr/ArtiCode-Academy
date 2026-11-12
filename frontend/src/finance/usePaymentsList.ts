// State of the receipts table (J-F52): API-152 through the shared keyset hook,
// newest first, with the filters the contract offers — part of the receipt
// number, the method, the status, the student and a range of days. The days
// are calendar days of `timeZone` (the academy's, this device's until it is
// known) turned into the instants the server compares: `from` = the first
// moment of the first day (paidAt ≥ from) and `to` = the first moment of the
// day AFTER the last one (paidAt < to — the server's upper bound is exclusive).
import { listPayments } from '../api/payments'
import type { Payment, PaymentMethod, PaymentStatus } from '../api/payments'
import { dayStartIn } from '../assignments/assignments.zone'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'
import { addDays, isCalendarDate } from '../timetable/timetable.dates'

export const PAYMENT_PAGE_SIZES = [20, 50, 100] as const

export interface PaymentsListFilters {
  /** Part of the receipt number (sent trimmed, 1..32 characters). */
  q: string
  method: PaymentMethod | undefined
  status: PaymentStatus | undefined
  studentId: string | undefined
  /** Calendar days (`YYYY-MM-DD`) of `timeZone`; blank = open-ended. */
  from: string | undefined
  to: string | undefined
  timeZone: string
  limit: (typeof PAYMENT_PAGE_SIZES)[number]
}

export function defaultPaymentFilters(timeZone: string): PaymentsListFilters {
  return { q: '', method: undefined, status: undefined, studentId: undefined, from: undefined, to: undefined, timeZone, limit: 20 }
}

/** True when the list is narrowed (the page size and the zone narrow nothing). */
export function hasActivePaymentFilters(filters: PaymentsListFilters): boolean {
  return Boolean(filters.q.trim() || filters.method || filters.status || filters.studentId || filters.from || filters.to)
}

/** The exclusive upper bound of a last day: the first moment of the next day in `timeZone`. */
export function dayAfterStart(day: string | undefined, timeZone: string): string | undefined {
  return day && isCalendarDate(day) ? dayStartIn(addDays(day, 1), timeZone) : undefined
}

const loadPayments: KeysetLoader<Payment, PaymentsListFilters> = (filters, cursor, signal) =>
  listPayments(
    {
      q: filters.q,
      method: filters.method,
      status: filters.status,
      studentId: filters.studentId,
      from: dayStartIn(filters.from, filters.timeZone),
      to: dayAfterStart(filters.to, filters.timeZone),
      limit: filters.limit,
      cursor,
    },
    signal,
  )

export function usePaymentsList(initialFilters: PaymentsListFilters) {
  return useKeysetList(loadPayments, initialFilters)
}
