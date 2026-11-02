// Maps a failed courses request to a translation key (and, where the backend
// code points at one input, the form field that should carry the message).
// Codes: backend/src/courses/courses.errors.ts plus the auth/permission guards.
import { ApiError } from '../api/client'
import type { UsersFailure } from '../users/users.errors'

export { failureMessage } from '../users/users.errors'

/** Same shape as a users failure, so `failureMessage()` renders both. */
export type CoursesFailure = UsersFailure

const KNOWN_CODES = new Set([
  'course_not_found',
  'course_code_taken',
  'course_not_deletable',
  'invalid_transition',
  'age_range_invalid',
  'cursor_invalid',
  'level_not_found',
  'nothing_to_update',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

const FIELD_OF_CODE: Readonly<Record<string, string[]>> = {
  course_code_taken: ['code'],
  age_range_invalid: ['maxAge'],
  level_not_found: ['levelId'],
}

function stringList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items.join(', ') : undefined
}

export function describeCoursesFailure(error: unknown): CoursesFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: CoursesFailure = { key: `courses.errors.${error.code}` }
    const field = FIELD_OF_CODE[error.code]
    if (field) failure.field = field
    const list = stringList(body.missing)
    if (list) failure.params = { list: `(${list})` }
    return failure
  }
  if (error.status === 400) return { key: 'courses.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
