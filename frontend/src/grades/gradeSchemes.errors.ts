// Maps a failed grade-schemes request (API-122..API-125) to a translation key
// under gradeSchemes.errors.* — the codes of backend/src/grades/grades.errors.ts
// that the schemes use, plus the auth/permission/origin guards. One code can
// carry several situations told apart by its details: `grade_scheme_is_default`
// by its `action` (deactivate | delete | unset_default | promote_inactive) and
// `grade_scheme_invalid` by its first problem in the server's order
// (GRADE_SCHEME_PROBLEMS); `grade_scheme_in_use` carries `finalGradeCount`.
import { ApiError } from '../api/client'
import type { UsersFailure } from '../users/users.errors'
import { GRADE_SCHEME_PROBLEMS } from './gradeSchemes.changes'

export { failureMessage } from '../users/users.errors'

/** Same shape as a users failure, so `failureMessage()` renders both. */
export type GradeSchemesFailure = UsersFailure

const KNOWN_CODES = new Set([
  'grade_scheme_not_found',
  'grade_scheme_invalid',
  'grade_scheme_is_default',
  'grade_scheme_in_use',
  'nothing_to_update',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

const IS_DEFAULT_ACTIONS = new Set(['deactivate', 'delete', 'unset_default', 'promote_inactive'])

function messageKeyOf(code: string, body: Record<string, unknown>): string {
  if (code === 'grade_scheme_is_default' && typeof body.action === 'string' && IS_DEFAULT_ACTIONS.has(body.action)) return `grade_scheme_is_default_${body.action}`
  if (code === 'grade_scheme_invalid' && Array.isArray(body.problems)) {
    const problems = body.problems as unknown[]
    const first = GRADE_SCHEME_PROBLEMS.find((problem) => problems.includes(problem))
    if (first) return `grade_scheme_invalid_${first}`
  }
  return code
}

function stringList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items.join(', ') : undefined
}

function numberList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is number => typeof item === 'number')
  return items.length > 0 ? items.join(', ') : undefined
}

export function describeGradeSchemesFailure(error: unknown): GradeSchemesFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: GradeSchemesFailure = { key: `gradeSchemes.errors.${messageKeyOf(error.code, body)}` }
    const params: Record<string, string> = {}
    const list = stringList(body.missing)
    if (list) params.list = `(${list})`
    const duplicates = numberList(body.duplicates)
    if (duplicates) params.duplicates = duplicates
    if (typeof body.finalGradeCount === 'number') params.finalGradeCount = String(body.finalGradeCount)
    if (Object.keys(params).length > 0) failure.params = params
    return failure
  }
  if (error.status === 400) {
    // Validation failures carry no code; the server lists the rejected constraints.
    return { key: 'gradeSchemes.errors.validation', params: { message: error.message } }
  }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}

/** The scheme no longer exists (deleted meanwhile): the screen re-reads its list. */
export function isGoneGradeScheme(failure: GradeSchemesFailure): boolean {
  return failure.key === 'gradeSchemes.errors.grade_scheme_not_found'
}
