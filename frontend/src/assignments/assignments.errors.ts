// Maps a failed assignments request to a translation key (and, where the
// backend code points at one input, the form field that should carry the
// message). Codes: backend/src/assignments/assignments.errors.ts — the T02 part
// (API-102..API-107) and, since J-F41, the T03 part (API-108..API-111): the
// review codes point at the grading form's fields (`score_out_of_range` →
// score, `feedback_required` → feedback); the codes of a student's submission
// (API-109) are worded now for «my assignments» (MOD-08-T04) — plus the
// auth/permission guards. Since J-F47 also the T07 part (D-R49):
// `review_conflict` (someone reviewed the attempt meanwhile — the review panel
// reads it again) and `attempt_conflict` (with the attempt numbers the server
// names). Unit-tested in assignments.errors.test.ts.
import { ApiError } from '../api/client'
import { failureMessage as usersFailureMessage } from '../users/users.errors'
import type { UsersFailure } from '../users/users.errors'
import { isAssignmentPatchField } from './assignments.patch'

/** A users failure plus, for `assignment_locked`, the refused fields as the server names them and the assignment's status then. */
export interface AssignmentsFailure extends UsersFailure {
  lockedFields?: string[]
  lockedStatus?: string
}

const KNOWN_CODES = new Set([
  'assignment_not_found',
  'class_not_found',
  'class_closed',
  'lesson_not_found',
  'lesson_mismatch',
  'late_penalty_invalid',
  'assignment_locked',
  'invalid_transition',
  'assignment_not_deletable',
  'nothing_to_update',
  'cursor_invalid',
  // T03 (API-108..API-111)
  'submission_not_found',
  'assignment_closed',
  'not_enrolled',
  'attempts_exhausted',
  'score_out_of_range',
  'feedback_required',
  'submission_invalid',
  // T07 (D-R49 — MOD-08-T07)
  'attempt_conflict',
  'review_conflict',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

/** Form fields (AssignmentFormValues) a code points at; `class_*` only exist in the creation form. */
const FIELD_OF_CODE: Readonly<Record<string, string[]>> = {
  class_not_found: ['classId'],
  class_closed: ['classId'],
  lesson_not_found: ['lessonId'],
  lesson_mismatch: ['lessonId'],
  late_penalty_invalid: ['latePenaltyPercent'],
  // The grading form of the review panel (SubmissionReviewPanel).
  score_out_of_range: ['score'],
  feedback_required: ['feedback'],
}

/** The failure's text; `assignment_locked` lists the refused fields by their translated labels, not their API names. */
export function failureMessage(t: (key: string, options?: Record<string, unknown>) => string, failure: AssignmentsFailure): string {
  if (!failure.lockedFields?.length) return usersFailureMessage(t, failure)
  const names = failure.lockedFields.map((field) => (isAssignmentPatchField(field) ? t(`assignments.patchFields.${field}`) : field))
  return usersFailureMessage(t, { ...failure, params: { ...failure.params, list: `(${names.join(t('assignments.errors.listSeparator'))})` } })
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—'
}

export function describeAssignmentsFailure(error: unknown): AssignmentsFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: AssignmentsFailure = { key: `assignments.errors.${error.code}` }
    const field = FIELD_OF_CODE[error.code]
    if (field) failure.field = field
    if (error.code === 'assignment_locked') {
      if (strings(body.fields).length > 0) failure.lockedFields = strings(body.fields)
      if (typeof body.status === 'string') failure.lockedStatus = body.status
    }
    const missing = strings(body.missing)
    if (missing.length > 0) failure.params = { list: `(${missing.join(', ')})` }
    // The limits the server names: the max score of `score_out_of_range`, the effective allowance of `attempts_exhausted`.
    if (error.code === 'score_out_of_range' && typeof body.maxScore === 'number') failure.params = { max: String(body.maxScore) }
    if (error.code === 'attempts_exhausted' && typeof body.maxAttempts === 'number' && typeof body.attempts === 'number') {
      failure.params = { allowed: String(body.maxAttempts), attempts: String(body.attempts) }
    }
    // The attempt the request named and the one the server expected next.
    if (error.code === 'attempt_conflict') failure.params = { expected: numberText(body.expected), next: numberText(body.next) }
    return failure
  }
  if (error.status === 400) return { key: 'assignments.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}

/** True for the failure of one code (`assignments.errors.<code>`). */
export function isAssignmentsFailure(failure: AssignmentsFailure, code: string): boolean {
  return failure.key === `assignments.errors.${code}`
}
