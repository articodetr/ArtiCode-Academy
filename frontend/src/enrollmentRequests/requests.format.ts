// Presentation rules of an enrollment request (MOD-19), pure. The page shows
// what the server computed — the payment state, the totals and the request
// state come from API-224/225; nothing here adds or compares money.
import type { RequestListState } from '../api/enrollmentRequests'
import { REQUEST_LIST_STATES } from '../api/enrollmentRequests'
import type { RequestState } from '../api/catalog'
import type { RequestPaymentState } from '../api/enrollments'

/** Upper bound of the search (`q`, 1–100 characters after trim — ListEnrollmentRequestsQueryDto). */
export const REQUEST_SEARCH_MAX_LENGTH = 100
/** Upper bound of the rejection reason (ENROLLMENT_REASON_MAX_LENGTH, ck_enrollments_rejection_reason_text). */
export const REJECTION_REASON_MAX_LENGTH = 500
/** The list filter the page opens with — the server's default too. */
export const DEFAULT_REQUEST_STATE: RequestListState = 'pending'
export const REQUEST_STATE_FILTERS: readonly RequestListState[] = REQUEST_LIST_STATES

export const PAYMENT_STATE_COLORS: Readonly<Record<RequestPaymentState, string>> = {
  not_required: 'default',
  missing: 'orange',
  unpaid: 'red',
  partial: 'gold',
  paid: 'green',
}

export const REQUEST_STATE_COLORS: Readonly<Record<RequestState, string>> = {
  pending_payment: 'gold',
  pending_approval: 'blue',
  enrolled: 'green',
  completed: 'green',
  withdrawn: 'orange',
  rejected: 'red',
  cancelled: 'default',
}

/**
 * The rejection reason as the server will store it: trimmed; null when it is
 * blank or longer than the limit (the form refuses both before any request).
 */
export function rejectionReasonOf(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length >= 1 && trimmed.length <= REJECTION_REASON_MAX_LENGTH ? trimmed : null
}

/** The search as the API takes it: trimmed, blank = absent, at most 100 characters. */
export function requestSearchOf(value: string): string | undefined {
  const trimmed = value.trim().slice(0, REQUEST_SEARCH_MAX_LENGTH)
  return trimmed ? trimmed : undefined
}
