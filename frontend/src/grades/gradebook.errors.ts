// Maps a failed gradebook request (API-126..API-128) to a translation key under
// gradebook.errors.* and to what the tab should do next. Codes: the gradebook
// part of backend/src/grades/grades.errors.ts — the one MOD-09 dictionary —
// plus `grades_certified` (MOD-10-T02, D-R54) and the auth/permission/origin
// guards. A refusal that means the gradebook changed under the screen (409
// `class_not_gradable`, `grades_not_ready`, `grade_scheme_missing`,
// `grades_certified`) re-reads it; 404 `class_not_found` means the class is out
// of reach; 404 `grade_scheme_not_found` means the chosen scheme went away (the
// dialog re-reads the schemes). `grades_not_ready` names what still blocks with
// the server's counts (gradebookFailureMessage() words them), or the reason
// `no_weighted_components`. Unit-tested in gradebook.errors.test.ts.
import { ApiError } from '../api/client'
import type { GradebookReadiness } from '../api/gradebook'
import { failureMessage as usersFailureMessage } from '../users/users.errors'
import type { UsersFailure } from '../users/users.errors'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** The blocking counts of `grades_not_ready`, in the order the message names them. */
export const NOT_READY_PARTS = ['openAssignments', 'awaitingReview', 'unpublishedExams'] as const
export type NotReadyPart = (typeof NOT_READY_PARTS)[number]

/** A users failure plus what the gradebook tab should do next. */
export interface GradebookFailure extends UsersFailure {
  /**
   * `stale`: the class, its sources or its certificates changed — re-read the gradebook;
   * `gone`: the class is out of reach (404 — deleted, or no longer taught by the caller);
   * `scheme`: the chosen grade scheme is gone or inactive — re-read the schemes and choose again.
   * Anything else (network, 5xx, 403, 429) can be retried as it is.
   */
  next?: 'stale' | 'gone' | 'scheme'
  /** `grades_not_ready`: the server's counts of what still blocks the finalization. */
  blockers?: Partial<Pick<GradebookReadiness, NotReadyPart>>
  /** `class_not_gradable`: the class's status the server names. */
  classStatus?: string
}

const KNOWN_CODES = new Set([
  'class_not_found',
  'class_not_gradable',
  'grades_not_ready',
  'grade_scheme_missing',
  'grade_scheme_not_found',
  'grades_certified',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

const NEXT_OF_CODE: Readonly<Record<string, GradebookFailure['next']>> = {
  class_not_found: 'gone',
  class_not_gradable: 'stale',
  grades_not_ready: 'stale',
  grade_scheme_missing: 'stale',
  grades_certified: 'stale',
  grade_scheme_not_found: 'scheme',
}

function bodyOf(error: ApiError): Record<string, unknown> {
  return (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function describeGradebookFailure(error: unknown): GradebookFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = bodyOf(error)
  if (error.code && KNOWN_CODES.has(error.code)) {
    const code = error.code
    const failure: GradebookFailure = { key: `gradebook.errors.${code}` }
    const next = NEXT_OF_CODE[code]
    if (next) failure.next = next
    if (code === 'grades_not_ready') {
      if (body.reason === 'no_weighted_components') failure.key = 'gradebook.errors.grades_not_ready_no_weighted_components'
      else {
        const blockers: Partial<Record<NotReadyPart, number>> = {}
        for (const part of NOT_READY_PARTS) {
          const count = body[part]
          if (typeof count === 'number') blockers[part] = count
        }
        failure.blockers = blockers
      }
    }
    if (code === 'class_not_gradable' && typeof body.status === 'string') failure.classStatus = body.status
    if (code === 'grades_certified' && typeof body.certificateCount === 'number') failure.params = { certificateCount: String(body.certificateCount) }
    const missing = strings(body.missing)
    if (missing.length > 0) failure.params = { ...failure.params, list: `(${missing.join(', ')})` }
    return failure
  }
  if (error.status === 400) return { key: 'gradebook.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}

/**
 * The failure's text: `grades_not_ready` names each blocker the server counted
 * (above 0) with its count; `class_not_gradable` names the class's status by
 * its label.
 */
export function gradebookFailureMessage(t: Translate, failure: GradebookFailure): string {
  const params: Record<string, string> = { ...failure.params }
  if (failure.blockers) {
    const parts = NOT_READY_PARTS.flatMap((part) => {
      const count = failure.blockers?.[part]
      return count !== undefined && count > 0 ? [t(`gradebook.errors.parts.${part}`, { count })] : []
    })
    // A refusal without a positive count (never sent today) still reads as a sentence.
    if (parts.length === 0) return usersFailureMessage(t, { key: 'gradebook.errors.grades_not_ready_generic' })
    params.list = parts.join(t('gradebook.errors.listSeparator'))
  }
  if (failure.classStatus) params.status = t(`labels.${failure.classStatus}`, { defaultValue: failure.classStatus })
  return usersFailureMessage(t, { ...failure, params })
}

/** True for the failure of one code (`gradebook.errors.<code>`). */
export function isGradebookFailure(failure: GradebookFailure, code: string): boolean {
  return failure.key === `gradebook.errors.${code}`
}
