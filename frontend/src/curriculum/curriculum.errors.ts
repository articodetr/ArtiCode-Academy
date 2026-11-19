// Maps a failed curriculum request (API-226..228) to a translation key under
// curriculum.errors.*, with the details the editor acts on: the lessons the
// server refused to delete (409 lesson_has_progress { itemIds }) and the
// problems of a refused content (400 content_invalid { problems }). Codes:
// backend/src/learning/learning.errors.ts, the MOD-04 course_not_found, and the
// auth/permission guards.
import { ApiError } from '../api/client'
import { failureMessage } from '../users/users.errors'
import type { UsersFailure } from '../users/users.errors'

export { failureMessage }

export interface CurriculumFailure extends UsersFailure {
  /** The server's code, when it is one this screen knows. */
  code: string | null
  /** 409 lesson_has_progress: the lessons learners have progress on. */
  itemIds?: string[]
  /** 400 content_invalid: the server's own wording of each problem. */
  problems?: string[]
}

const KNOWN_CODES = new Set([
  'course_not_found',
  'curriculum_invalid',
  'lesson_has_progress',
  'content_invalid',
  'lesson_not_found',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

export function describeCurriculumFailure(error: unknown): CurriculumFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network', code: null }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: CurriculumFailure = { key: `curriculum.errors.${error.code}`, code: error.code }
    const missing = strings(body.missing)
    if (missing.length > 0) failure.params = { list: `(${missing.join(', ')})` }
    if (error.code === 'lesson_has_progress') failure.itemIds = strings(body.itemIds)
    if (error.code === 'content_invalid') failure.problems = strings(body.problems)
    return failure
  }
  if (error.status === 400) return { key: 'curriculum.errors.validation', code: null, params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server', code: null }
  return { key: 'login.errors.generic', code: null }
}
