// Maps a failed finance request to a translation key and its parameters.
// Codes: backend/src/finance/finance.errors.ts (the whole MOD-11 dictionary)
// plus the auth/permission guards and `academy_not_configured`.
import { ApiError } from '../api/client'
import { failureMessage } from '../users/users.errors'
import type { UsersFailure } from '../users/users.errors'

export type PaymentsFailure = UsersFailure
export { failureMessage }

const KNOWN_CODES = new Set([
  'fee_plan_not_found',
  'fee_plan_invalid',
  'fee_plan_in_use',
  'fee_plan_inactive',
  'course_not_found',
  'class_not_found',
  'fee_plan_mismatch',
  'invoice_not_found',
  'student_not_found',
  'enrollment_mismatch',
  'invoice_invalid',
  'invoice_not_draft',
  'invoice_not_issued',
  'invoice_has_payments',
  'invalid_transition',
  'payment_exceeds_balance',
  'payment_not_found',
  'payment_reversed',
  'nothing_to_update',
  'cursor_invalid',
  'academy_not_configured',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

/** After these the invoice on screen is out of date: the drawer re-reads it. */
const STALE_CODES = new Set(['invoice_not_issued', 'invoice_has_payments', 'invalid_transition', 'payment_exceeds_balance', 'payment_reversed'])

export function isStaleInvoice(error: unknown): boolean {
  return error instanceof ApiError && error.code !== null && STALE_CODES.has(error.code)
}

/** The form field a refusal belongs to in the fee plan and draft invoice forms. */
const FIELD_OF_CODE: Record<string, string> = {
  fee_plan_mismatch: 'feePlanId',
  fee_plan_inactive: 'feePlanId',
  fee_plan_not_found: 'feePlanId',
  student_not_found: 'studentId',
  enrollment_mismatch: 'classId',
  class_not_found: 'classId',
  course_not_found: 'courseId',
}

/** The `problems` of a `fee_plan_invalid` / `invoice_invalid` refusal (strings only), else []. */
export function problemsOf(error: unknown): string[] {
  if (!(error instanceof ApiError) || (error.code !== 'invoice_invalid' && error.code !== 'fee_plan_invalid')) return []
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  return Array.isArray(body.problems) ? body.problems.filter((item): item is string => typeof item === 'string') : []
}

function formatted(value: unknown): string | undefined {
  return typeof value === 'number' ? String(value) : typeof value === 'string' ? value : undefined
}

export function describePaymentsFailure(error: unknown): PaymentsFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: PaymentsFailure = { key: `payments.errors.${error.code}` }
    const params: Record<string, string> = {}
    if (Array.isArray(body.missing)) params.list = `(${body.missing.filter((item) => typeof item === 'string').join(', ')})`
    if (Array.isArray(body.problems)) params.list = `(${body.problems.filter((item) => typeof item === 'string').join(', ')})`
    for (const key of ['amount', 'balance', 'paymentCount', 'status', 'from', 'invoiceCount']) {
      const value = formatted(body[key])
      if (value !== undefined) params[key] = value
    }
    if (error.code === 'payment_exceeds_balance') failure.field = ['amount']
    const field = FIELD_OF_CODE[error.code]
    if (field) failure.field = [field]
    if (Object.keys(params).length > 0) failure.params = params
    return failure
  }
  if (error.status === 400) return { key: 'payments.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
