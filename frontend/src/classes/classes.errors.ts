// Maps a failed classes request to a translation key (and, where the backend
// code points at one input, the form field that should carry the message).
// Codes: backend/src/classes/classes.errors.ts — the whole MOD-05 dictionary
// (classes and teachers since J-F01, the enrollment codes of T04 since J-F04)
// plus the auth/permission guards.
import { ApiError } from '../api/client'
import { failureMessage as renderFailure } from '../users/users.errors'
import type { UsersFailure } from '../users/users.errors'

/** Same shape as a users failure, so `failureMessage()` renders both. */
export type ClassesFailure = UsersFailure

type Translate = (key: string, options?: Record<string, unknown>) => string

/** As the users renderer, with a `status` detail (of `already_enrolled`) shown through its `labels.*` text. */
export function failureMessage(t: Translate, failure: ClassesFailure): string {
  const status = failure.params?.status
  return renderFailure(t, status ? { ...failure, params: { ...failure.params, status: t(`labels.${status}`) } } : failure)
}

const KNOWN_CODES = new Set([
  'class_not_found',
  'class_code_taken',
  'class_not_deletable',
  'capacity_below_enrolled',
  'course_not_found',
  'course_not_published',
  'invalid_transition',
  'date_range_invalid',
  'nothing_to_update',
  'cursor_invalid',
  'teachers_invalid',
  'not_a_teacher',
  'user_not_eligible',
  'user_not_found',
  // T04 — enrollments (J-F04)
  'class_not_enrollable',
  'class_full',
  'not_a_student',
  'already_enrolled',
  'enrollment_not_found',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

const FIELD_OF_CODE: Readonly<Record<string, string[]>> = {
  class_code_taken: ['code'],
  capacity_below_enrolled: ['capacity'],
  date_range_invalid: ['endsOn'],
  course_not_found: ['courseId'],
  course_not_published: ['courseId'],
}

/** Codes whose `userId` detail names one user of the request (a teacher of the list, or the student being enrolled). */
const USER_CODES = new Set(['not_a_teacher', 'not_a_student', 'user_not_eligible', 'user_not_found'])

/**
 * Codes after which a class action confirmed in the drawer (API-054/API-055) is
 * out of date (owner's review of PR #26, note 3 — J-F15): the class moved to
 * another status (`invalid_transition`), can no longer be deleted
 * (`class_not_deletable`), or is gone or no longer visible to the caller
 * (`class_not_found`). The same action cannot succeed again, so the drawer
 * closes the dialog, re-reads the class and shows the message. Every other
 * failure keeps the dialog open with the message: the same action can be
 * retried (network, 5xx, 429 `rate_limited`, a 400 on the reason) or cancelled
 * (403 `permission_denied` / `origin_forbidden`, anything else).
 */
const STALE_ACTION_CODES = new Set(['invalid_transition', 'class_not_deletable', 'class_not_found'])

const CLASSES_ERROR_PREFIX = 'classes.errors.'

export function isStaleClassAction(failure: ClassesFailure): boolean {
  return failure.key.startsWith(CLASSES_ERROR_PREFIX) && STALE_ACTION_CODES.has(failure.key.slice(CLASSES_ERROR_PREFIX.length))
}

function stringList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items.join(', ') : undefined
}

/**
 * `nameOf` turns the `userId` of a teacher error into the name the editor
 * shows (falls back to the id).
 */
export function describeClassesFailure(error: unknown, nameOf?: (userId: string) => string | undefined): ClassesFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: ClassesFailure = { key: `classes.errors.${error.code}` }
    const field = FIELD_OF_CODE[error.code]
    if (field) failure.field = field
    const params: Record<string, string> = {}
    const list = stringList(body.missing)
    if (list) params.list = `(${list})`
    if (typeof body.enrolledCount === 'number') params.enrolledCount = String(body.enrolledCount)
    if (typeof body.enrollmentCount === 'number') params.enrollmentCount = String(body.enrollmentCount)
    if (typeof body.capacity === 'number') params.capacity = String(body.capacity)
    // `already_enrolled` names the status of the existing enrollment (translated through labels.*).
    if (error.code === 'already_enrolled' && typeof body.status === 'string') params.status = body.status
    if (USER_CODES.has(error.code)) params.name = typeof body.userId === 'string' ? (nameOf?.(body.userId) ?? body.userId) : ''
    if (Object.keys(params).length > 0) failure.params = params
    return failure
  }
  if (error.status === 400) return { key: 'classes.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
