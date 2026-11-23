// Maps a failed request of the «attempts» tab (API-273 regrade, API-274 the
// roster, API-275 one attempt) to a translation key, on the pattern of
// exams.errors.ts; and adds to the results sheet's mapper the one refusal an
// online exam brings (API-120 `result_from_attempt`). Codes: the online part
// of backend/src/grades/grades.errors.ts. The refusals a regrade can answer,
// in the server's order: `exam_not_found` (404), `exam_not_online`,
// `exam_not_frozen { status }` (a draft), `class_closed` (a cancelled class),
// `grades_certified { classId, certificateCount }` (409); plus
// `permission_denied { missing }` from the guard and a 400 for a reason that
// is missing or too long. Everything else — and the codes the exams screens
// already word — falls back to describeExamsFailure(). Unit-tested in
// examAttempts.errors.test.ts.
import { ApiError } from '../api/client'
import type { Translate } from '../users/users.format'
import { describeExamsFailure, describeResultsFailure, failureMessage as examsFailureMessage } from './exams.errors'
import type { ExamsFailure, ResultsFailure } from './exams.errors'

/** An exams failure plus, for a counted message, its number (i18next plurals need a number; `params` carries strings). */
export interface AttemptsFailure extends ExamsFailure {
  count?: number
}

/** Codes worded under `examAttempts.errors.*` — what they mean for a regrade or an attempt, not for an exam write. */
const OWN_CODES = new Set(['grades_certified', 'exam_not_frozen', 'exam_not_online', 'class_closed', 'attempt_not_found'])

/** The exam is no longer what the drawer shows (draft again, manual, its class cancelled, gone): the drawer re-reads it. */
const STALE_EXAM_CODES = ['exam_not_frozen', 'exam_not_online', 'class_closed', 'exam_not_found']

function bodyOf(error: ApiError): Record<string, unknown> {
  return (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function describeAttemptsFailure(error: unknown): AttemptsFailure {
  if (error instanceof ApiError && error.code && OWN_CODES.has(error.code)) {
    const failure: AttemptsFailure = { key: `examAttempts.errors.${error.code}` }
    if (error.code === 'grades_certified') {
      const count = bodyOf(error).certificateCount
      if (typeof count === 'number' && Number.isInteger(count) && count > 0) failure.count = count
    }
    return failure
  }
  return describeExamsFailure(error)
}

/** The failure's text; a counted one (`count`) picks its plural form. */
export function failureMessage(t: Translate, failure: AttemptsFailure): string {
  const { count } = failure
  if (count === undefined) return examsFailureMessage(t, failure)
  return examsFailureMessage((key, options) => t(key, { ...options, count }), failure)
}

/** True for the failure of one code, whichever dictionary words it (`examAttempts.errors.*` or `exams.errors.*`). */
export function isAttemptsFailure(failure: AttemptsFailure, code: string): boolean {
  return failure.key === `examAttempts.errors.${code}` || failure.key === `exams.errors.${code}`
}

/** True when the refusal says the exam changed elsewhere, so the drawer should read it again. */
export function isStaleExamFailure(failure: AttemptsFailure): boolean {
  return STALE_EXAM_CODES.some((code) => isAttemptsFailure(failure, code))
}

/** A failed save of the results sheet; `fromAttempt` when the server refused students who have an attempt. */
export interface SheetFailure extends ResultsFailure {
  /**
   * API-120 `409 result_from_attempt { studentIds }`: these students started an attempt after the sheet was read, so
   * their result is their attempts'. The batch was refused whole; their rows lock and the sheet is read again.
   */
  fromAttempt?: boolean
}

/** describeResultsFailure() plus the refusal of an online exam's sheet. */
export function describeSheetFailure(error: unknown): SheetFailure {
  if (error instanceof ApiError && error.code === 'result_from_attempt') {
    const studentIds = strings(bodyOf(error).studentIds)
    return {
      key: studentIds.length > 0 ? 'examAttempts.sheet.errors.result_from_attempt' : 'examAttempts.sheet.errors.result_from_attempt_unnamed',
      next: 'refused',
      studentIds,
      fromAttempt: true,
    }
  }
  return describeResultsFailure(error)
}
