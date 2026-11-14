// The recorded payments list (API-152) on the shared keyset hook. The day
// filters are calendar days in the academy zone: `from` = the start of the
// first day, `to` = the start of the day after the last (the server's
// `paidAt < to` is exclusive), both as ISO instants.
import { listPayments } from '../api/payments'
import type { ListPaymentsParams, Payment } from '../api/payments'
import type { PaymentMethod, PaymentStatus } from '../api/invoices'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'
import { addDays, isCalendarDate, zonedInstant } from '../timetable/timetable.dates'

export const PAYMENT_PAGE_SIZES = [20, 50, 100] as const

export interface PaymentsListFilters {
  q?: string
  studentId?: string
  method?: PaymentMethod
  status?: PaymentStatus
  /** `YYYY-MM-DD`, first day included. */
  fromDay?: string
  /** `YYYY-MM-DD`, last day included. */
  toDay?: string
  /** The zone the days are read in (the academy's; else this device's). */
  timeZone: string
  limit: (typeof PAYMENT_PAGE_SIZES)[number]
}

const iso = (day: string, zone: string) => new Date(zonedInstant(day, '00:00', zone)).toISOString()

/** The API-152 query of the filters (without the cursor). */
export function paymentsQuery(filters: PaymentsListFilters): ListPaymentsParams {
  const params: ListPaymentsParams = { limit: filters.limit }
  if (filters.q) params.q = filters.q
  if (filters.studentId) params.studentId = filters.studentId
  if (filters.method) params.method = filters.method
  if (filters.status) params.status = filters.status
  if (filters.fromDay && isCalendarDate(filters.fromDay)) params.from = iso(filters.fromDay, filters.timeZone)
  if (filters.toDay && isCalendarDate(filters.toDay)) params.to = iso(addDays(filters.toDay, 1), filters.timeZone)
  return params
}

const loadPayments: KeysetLoader<Payment, PaymentsListFilters> = (filters, cursor, signal) => listPayments({ ...paymentsQuery(filters), cursor }, signal)

export function usePaymentsList(timeZone: string) {
  return useKeysetList<Payment, PaymentsListFilters>(loadPayments, { limit: 20, timeZone })
}
