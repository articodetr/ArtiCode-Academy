// Failures of the «الأسئلة» tab of the exam drawer (MOD-09 phase 2): reading and
// replacing the question set of an online exam (API-270/API-271) and
// correcting the key of a frozen question (API-272). Each maps the server's
// code and details to a worded message (i18n/ar/examOnline.ts) and says what
// the tab should do next, on the pattern of describeResultsFailure(); anything
// the two routes do not answer themselves — a missing permission, a validation
// refusal, the network — falls back to describeExamsFailure(). The text comes
// from failureMessage() of exams.errors.ts. Unit-tested in
// examQuestions.errors.test.ts.
//
// API-271 refuses, in this order and before any write: a question twice (400
// exam_questions_invalid { duplicates }), an unknown exam (404), a manual exam
// (409 exam_not_online), a cancelled class (409 class_closed), an exam that is
// no longer a draft (409 exam_questions_locked { status }), a question that is
// gone or in a bank the caller cannot see (404 question_not_found {
// questionIds }), a question that is not ready (422 question_not_ready {
// questionIds }). API-272: 404, exam_not_online, exam_not_frozen, class_closed,
// grades_certified { certificateCount } (409), question_not_found (404),
// key_invalid { problem } (400).
import { ApiError } from '../api/client'
import { KEY_PROBLEMS } from '../api/examQuestions'
import { describeExamsFailure } from './exams.errors'
import type { ExamsFailure } from './exams.errors'

/** Why the server refused a row of the set. */
export type RefusedRowReason = 'not_found' | 'not_ready' | 'duplicate'

export interface ExamQuestionsFailure extends ExamsFailure {
  /**
   * `stale`: the exam or what the request named changed elsewhere (no longer a draft, no longer frozen, no longer
   * online, its class cancelled, a question gone) — re-read the tab and the exam;
   * `gone`: the exam no longer exists or is out of reach (404);
   * `refused`: the set was refused as a whole because of some questions (nothing was written) — mark their rows.
   */
  next?: 'stale' | 'gone' | 'refused'
  /** The questions the server named: `question_not_found`, `question_not_ready`, the repeated ones of `exam_questions_invalid`. */
  questionIds?: string[]
  /** Why those rows were refused. */
  rowReason?: RefusedRowReason
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function bodyOf(error: ApiError): Record<string, unknown> {
  return (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
}

/** The whole set refused because of the rows the server named; `value` (their number) is what the message shows. */
function refusedRows(code: string, reason: RefusedRowReason, questionIds: string[]): ExamQuestionsFailure {
  return { key: `examOnline.editor.errors.${code}`, next: 'refused', questionIds, rowReason: reason, params: { value: String(questionIds.length) } }
}

/** A failed read (API-270) or save (API-271) of the question set. */
export function describeQuestionSetFailure(error: unknown): ExamQuestionsFailure {
  if (error instanceof ApiError) {
    const body = bodyOf(error)
    if (error.code === 'exam_questions_invalid') return refusedRows(error.code, 'duplicate', strings(body.duplicates))
    if (error.code === 'question_not_found') return refusedRows(error.code, 'not_found', strings(body.questionIds))
    if (error.code === 'question_not_ready') return refusedRows(error.code, 'not_ready', strings(body.questionIds))
    // The exam left its draft elsewhere: its questions are frozen (or it was published).
    if (error.code === 'exam_questions_locked') return { key: 'examOnline.editor.errors.exam_questions_locked', next: 'stale' }
    // On this route class_closed only means a cancelled class.
    if (error.code === 'class_closed') return { key: 'examOnline.editor.errors.class_closed', next: 'stale' }
    if (error.code === 'exam_not_online') return { key: 'examOnline.editor.errors.exam_not_online', next: 'stale' }
    if (error.code === 'exam_not_found') return { key: 'exams.errors.exam_not_found', next: 'gone' }
    if (error.status === 413) return { key: 'examOnline.editor.errors.too_large' }
  }
  return describeExamsFailure(error)
}

/** The `key_invalid` problems that mean the question on screen is no longer the server's (the others are the form's own to put right). */
const STALE_KEY_PROBLEMS: readonly string[] = ['option_unknown', 'not_allowed_for_type']

/** A failed key correction (API-272). */
export function describeKeyCorrectionFailure(error: unknown): ExamQuestionsFailure {
  if (error instanceof ApiError) {
    const body = bodyOf(error)
    if (error.code === 'key_invalid') {
      const problem = typeof body.problem === 'string' && (KEY_PROBLEMS as readonly string[]).includes(body.problem) ? body.problem : 'unknown'
      const failure: ExamQuestionsFailure = { key: `examOnline.key.errors.key_invalid.${problem}` }
      if (STALE_KEY_PROBLEMS.includes(problem)) failure.next = 'stale'
      return failure
    }
    // D-R54: what a certificate was built on is not rewritten.
    if (error.code === 'grades_certified') {
      return { key: 'examOnline.key.errors.grades_certified', params: { value: typeof body.certificateCount === 'number' ? String(body.certificateCount) : '' } }
    }
    if (error.code === 'exam_not_frozen' || error.code === 'exam_not_online' || error.code === 'class_closed' || error.code === 'question_not_found') {
      return { key: `examOnline.key.errors.${error.code}`, next: 'stale' }
    }
    if (error.code === 'exam_not_found') return { key: 'exams.errors.exam_not_found', next: 'gone' }
  }
  return describeExamsFailure(error)
}
