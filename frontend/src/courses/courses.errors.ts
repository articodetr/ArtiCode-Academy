// Maps a failed courses/levels/syllabus request to a translation key (and,
// where the backend code points at one input, the form field that should carry
// the message). Codes: backend/src/courses/courses.errors.ts plus the
// auth/permission guards.
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
  'level_code_taken',
  'level_in_use',
  'level_order_invalid',
  'syllabus_invalid',
  'nothing_to_update',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

const FIELD_OF_CODE: Readonly<Record<string, string[]>> = {
  course_code_taken: ['code'],
  level_code_taken: ['code'],
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
    const params: Record<string, string> = {}
    const list = stringList(body.missing)
    if (list) params.list = `(${list})`
    if (typeof body.courseCount === 'number') params.courseCount = String(body.courseCount)
    if (Object.keys(params).length > 0) failure.params = params
    return failure
  }
  if (error.status === 400) return { key: 'courses.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
