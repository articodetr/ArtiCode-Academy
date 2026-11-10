// Maps a failed exams request to a translation key (and, where the backend
// code points at one input, the form field that should carry the message).
// Codes: the exams part of backend/src/grades/grades.errors.ts — the one
// MOD-09 dictionary (API-113..API-120) — plus the auth/permission guards.
// describeResultsFailure() adds what the results sheet (API-119/API-120) should
// do next, on the pattern of attendance/attendance.errors.ts. Unit-tested in
// exams.errors.test.ts.
import { ApiError } from '../api/client'
import { failureMessage as usersFailureMessage } from '../users/users.errors'
import type { UsersFailure } from '../users/users.errors'
import { isExamPatchField } from './exams.patch'

/** A users failure plus, for `exam_locked`, the refused fields as the server names them and the exam's status then. */
export interface ExamsFailure extends UsersFailure {
  lockedFields?: string[]
  lockedStatus?: string
}

/** A failed save of the results sheet, with what the sheet should do next. */
export interface ResultsFailure extends ExamsFailure {
  /**
   * `stale`: the exam or its class changed elsewhere (back to draft, class cancelled) — re-read the sheet and the exam;
   * `gone`: the exam no longer exists or is out of reach (404);
   * `refused`: the batch was refused as a whole because of some students (nothing was written) — mark their rows.
   */
  next?: 'stale' | 'gone' | 'refused'
  /** The students the server named: `not_enrolled`, the one of `score_out_of_range`, the repeated ones of `results_invalid`. */
  studentIds?: string[]
}

const KNOWN_CODES = new Set([
  'exam_not_found',
  'class_not_found',
  'lesson_not_found',
  'lesson_mismatch',
  'class_closed',
  'pass_score_invalid',
  'exam_locked',
  'exam_has_results',
  'exam_not_deletable',
  'exam_not_recordable',
  'invalid_transition',
  'results_invalid',
  'not_enrolled',
  'score_out_of_range',
  'nothing_to_update',
  'cursor_invalid',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

/** Form fields (ExamFormValues) a code points at; `class_*` only exist in the creation form. */
const FIELD_OF_CODE: Readonly<Record<string, string[]>> = {
  class_not_found: ['classId'],
  class_closed: ['classId'],
  lesson_not_found: ['lessonId'],
  lesson_mismatch: ['lessonId'],
  pass_score_invalid: ['passScore'],
}

/** The failure's text; `exam_locked` lists the refused fields by their translated labels, not their API names. */
export function failureMessage(t: (key: string, options?: Record<string, unknown>) => string, failure: ExamsFailure): string {
  if (!failure.lockedFields?.length) return usersFailureMessage(t, failure)
  const names = failure.lockedFields.map((field) => (isExamPatchField(field) ? t(`exams.patchFields.${field}`) : field))
  return usersFailureMessage(t, { ...failure, params: { ...failure.params, list: `(${names.join(t('exams.errors.listSeparator'))})` } })
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function bodyOf(error: ApiError): Record<string, unknown> {
  return (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
}

export function describeExamsFailure(error: unknown): ExamsFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = bodyOf(error)
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: ExamsFailure = { key: `exams.errors.${error.code}` }
    const field = FIELD_OF_CODE[error.code]
    if (field) failure.field = field
    if (error.code === 'exam_locked') {
      if (strings(body.fields).length > 0) failure.lockedFields = strings(body.fields)
      if (typeof body.status === 'string') failure.lockedStatus = body.status
    }
    const missing = strings(body.missing)
    if (missing.length > 0) failure.params = { list: `(${missing.join(', ')})` }
    // The maximum the server names: the pass score's and a result's limit.
    if ((error.code === 'pass_score_invalid' || error.code === 'score_out_of_range') && typeof body.maxScore === 'number') failure.params = { max: String(body.maxScore) }
    return failure
  }
  if (error.status === 400) return { key: 'exams.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}

/** True for the failure of one code (`exams.errors.<code>`). */
export function isExamsFailure(failure: ExamsFailure, code: string): boolean {
  return failure.key === `exams.errors.${code}`
}

/** A failed read or save of the results sheet (API-119/API-120); anything not specific to the sheet falls back to describeExamsFailure(). */
export function describeResultsFailure(error: unknown): ResultsFailure {
  if (error instanceof ApiError) {
    const body = bodyOf(error)
    // The exam went back to draft elsewhere (the only reason the server gives).
    if (error.code === 'exam_not_recordable') return { key: 'exams.results.errors.not_scheduled', next: 'stale' }
    // On this route class_closed only means a cancelled class (a completed one stays open for corrections — D-R33).
    if (error.code === 'class_closed') return { key: 'exams.results.errors.class_cancelled', next: 'stale' }
    if (error.code === 'not_enrolled') return { key: 'exams.results.errors.not_enrolled', next: 'refused', studentIds: strings(body.studentIds) }
    if (error.code === 'score_out_of_range') {
      const failure: ResultsFailure = { key: 'exams.results.errors.score_out_of_range', next: 'refused', studentIds: typeof body.studentId === 'string' ? [body.studentId] : [] }
      if (typeof body.maxScore === 'number') failure.params = { max: String(body.maxScore) }
      return failure
    }
    if (error.code === 'results_invalid') return { key: 'exams.results.errors.results_invalid', next: 'refused', studentIds: strings(body.duplicates) }
    if (error.code === 'exam_not_found') return { key: 'exams.errors.exam_not_found', next: 'gone' }
    if (error.status === 413) return { key: 'exams.results.errors.too_large' }
  }
  return describeExamsFailure(error)
}
