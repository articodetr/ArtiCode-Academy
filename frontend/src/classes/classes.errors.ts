// Maps a failed classes request to a translation key (and, where the backend
// code points at one input, the form field that should carry the message).
// Codes: backend/src/classes/classes.errors.ts (the T02/T03 part) plus the
// auth/permission guards. The enrollment codes of T04 belong to J-F04.
import { ApiError } from '../api/client'
import type { UsersFailure } from '../users/users.errors'

export { failureMessage } from '../users/users.errors'

/** Same shape as a users failure, so `failureMessage()` renders both. */
export type ClassesFailure = UsersFailure

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

/** Codes whose `userId` detail names one teacher of the submitted list. */
const USER_CODES = new Set(['not_a_teacher', 'user_not_eligible', 'user_not_found'])

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
    if (USER_CODES.has(error.code)) params.name = typeof body.userId === 'string' ? (nameOf?.(body.userId) ?? body.userId) : ''
    if (Object.keys(params).length > 0) failure.params = params
    return failure
  }
  if (error.status === 400) return { key: 'classes.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
