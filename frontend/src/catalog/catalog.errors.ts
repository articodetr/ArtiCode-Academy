// What the learner's catalog screens say when a request fails (MOD-19): the
// server's stable `code` → a key of `catalog.errors`. A network failure and a
// server error have their own words; any other refusal falls back to the
// server error text. Pure; unit-tested in catalog.errors.test.ts.
import { ApiError } from '../api/client'

const KNOWN_CODES = new Set([
  'request_pending',
  'already_enrolled',
  'class_full',
  'class_not_enrollable',
  'course_price_unavailable',
  'class_not_found',
  'not_a_student',
  'permission_denied',
  'course_not_found',
  'request_has_payments',
  'invalid_transition',
  'request_not_found',
])

/** The i18n key under `catalog.errors` for a failure. */
export function catalogFailureKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'catalog.errors.network'
  if (error.code && KNOWN_CODES.has(error.code)) return `catalog.errors.${error.code}`
  if (error.status === 403) return 'catalog.errors.permission_denied'
  return 'catalog.errors.server'
}

/** True for the page-level «this course does not exist» answer of API-220. */
export function isCourseGone(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'course_not_found' || error.status === 404)
}
