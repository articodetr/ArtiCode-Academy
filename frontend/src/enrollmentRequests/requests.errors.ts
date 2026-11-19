// Maps a failed request of the enrollment requests page (API-224/225, API-059
// approve/reject) to a translation key under `enrollmentRequests.errors.*`.
// Codes: backend/src/catalog/catalog.errors.ts (MOD-19), the MOD-05 codes an
// approval can meet (backend/src/classes/classes.errors.ts) and the guards.
// The record-payment dialog keeps its own mapping (payments/payments.errors.ts).
import { ApiError } from '../api/client'
import { unpaidInvoicesOf } from '../classes/classes.errors'
import { failureMessage } from '../users/users.errors'
import type { UsersFailure } from '../users/users.errors'

export type RequestsFailure = UsersFailure
export { failureMessage }

const KNOWN_CODES = new Set([
  'payment_required',
  'request_has_payments',
  'rejection_reason_required',
  'invalid_transition',
  'class_full',
  'class_not_enrollable',
  'request_not_found',
  'enrollment_not_found',
  'user_not_eligible',
  'user_not_found',
  'not_a_student',
  'payment_exceeds_balance',
  'invoice_not_issued',
  'cursor_invalid',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

/** After these the request on screen is out of date: the drawer re-reads it, and the list too. */
const STALE_CODES = new Set(['payment_required', 'request_has_payments', 'invalid_transition', 'class_full', 'class_not_enrollable', 'invoice_not_issued', 'enrollment_not_found'])

const PREFIX = 'enrollmentRequests.errors.'

export function isStaleRequest(failure: RequestsFailure): boolean {
  return failure.key.startsWith(PREFIX) && STALE_CODES.has(failure.key.slice(PREFIX.length))
}

/** The request no longer exists for the caller: the drawer closes. */
export function isGoneRequest(failure: RequestsFailure): boolean {
  return failure.key === `${PREFIX}request_not_found`
}

export function describeRequestsFailure(error: unknown): RequestsFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: RequestsFailure = { key: `${PREFIX}${error.code}` }
    const params: Record<string, string> = {}
    if (Array.isArray(body.missing)) params.list = `(${body.missing.filter((item) => typeof item === 'string').join(', ')})`
    if (error.code === 'payment_required') params.invoices = unpaidInvoicesOf(body.invoices)
    if (typeof body.paymentCount === 'number') params.paymentCount = String(body.paymentCount)
    if (typeof body.enrolledCount === 'number') params.enrolledCount = String(body.enrolledCount)
    if (typeof body.capacity === 'number') params.capacity = String(body.capacity)
    if (Object.keys(params).length > 0) failure.params = params
    return failure
  }
  if (error.status === 400) return { key: `${PREFIX}validation`, params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
