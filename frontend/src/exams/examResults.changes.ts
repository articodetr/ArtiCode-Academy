// Pure rules of the results sheet (J-F45), unit-tested in
// examResults.changes.test.ts, on the pattern of attendance/attendance.changes.ts.
// A draft is what the editor shows for one student; the save plan sends ONE PUT
// (API-120) with the rows whose draft differs from the server's result — each
// as the WHOLE new state of that result, so a score left out (any status but
// `scored`) or a feedback emptied is cleared on the server — and nothing when
// no row changed. A score is compared at two decimals, as the server compares
// its `numeric(6,2)` text (planResultsBatch()). Local rules mirror
// backend/src/exams/exam-results.{dto,changes}.ts; the server decides. Every
// count on screen is the server's answer — nothing is added up here.
import { RESULTS_BATCH_MAX, RESULT_ENROLLMENT_STATUSES, RESULT_FEEDBACK_MAX_LENGTH } from '../api/examResults'
import type { ExamResultInput, ExamResultItem, ExamResultStatus, RecordExamResultsInput } from '../api/examResults'
import { isResultScoreValid } from './exams.validation'

/** One row of the editor. `status` undefined = no result yet (and nothing chosen). */
export interface ResultDraft {
  status: ExamResultStatus | undefined
  /** InputNumber value; kept for `scored` only. */
  score: number | null
  feedback: string
}

/** Drafts the user touched, by student id; the other rows show the server's result. */
export type ResultDrafts = ReadonlyMap<string, ResultDraft>

/** Why a draft cannot be sent: `scored` without a score, a score outside 0..maxScore (or with more than two decimals), a feedback too long. */
export type ResultDraftProblem = 'score_required' | 'score_invalid' | 'feedback_too_long'

/** True when the student may be recorded: an active or completed enrollment (anyone else is refused with `not_enrolled`). */
export function isRecordableItem(item: Pick<ExamResultItem, 'enrollmentStatus'>): boolean {
  return item.enrollmentStatus !== null && RESULT_ENROLLMENT_STATUSES.includes(item.enrollmentStatus)
}

/** The draft of an untouched row: the server's result, or nothing chosen. */
export function draftOf(item: Pick<ExamResultItem, 'result'>): ResultDraft {
  return { status: item.result?.status, score: item.result?.score ?? null, feedback: item.result?.feedback ?? '' }
}

/** The row as shown: the touched draft, else the server's result. */
export function currentDraft(item: ExamResultItem, drafts: ResultDrafts): ResultDraft {
  return drafts.get(item.student.id) ?? draftOf(item)
}

/** The values the server would store for a draft: the score with `scored` only, the feedback trimmed (blank = none). */
export function normaliseDraft(draft: ResultDraft): { status: ExamResultStatus | undefined; score: number | null; feedback: string | null } {
  const feedback = draft.feedback.trim()
  return { status: draft.status, score: draft.status === 'scored' ? draft.score : null, feedback: feedback === '' ? null : feedback }
}

/** A `numeric(6,2)` value as the server compares it. */
const decimal = (value: number | null) => (value === null ? null : value.toFixed(2))

/** True when the draft would change the student's result (a row without a result changes once a status is chosen). */
export function isDraftChanged(item: ExamResultItem, draft: ResultDraft): boolean {
  const next = normaliseDraft(draft)
  if (!item.result) return next.status !== undefined
  return next.status !== item.result.status || decimal(next.score) !== decimal(item.result.score) || next.feedback !== item.result.feedback
}

/** The local mirror of the DTO rules for a draft about to be sent (`maxScore` from the sheet), or null when it is fine. */
export function draftProblem(draft: ResultDraft, maxScore: number): ResultDraftProblem | null {
  const next = normaliseDraft(draft)
  if (next.status === 'scored') {
    if (next.score === null) return 'score_required'
    if (!isResultScoreValid(next.score, maxScore)) return 'score_invalid'
  }
  if (next.feedback !== null && next.feedback.length > RESULT_FEEDBACK_MAX_LENGTH) return 'feedback_too_long'
  return null
}

/** The recordable rows whose draft differs from the server's result, in sheet order. */
export function changedItems(items: readonly ExamResultItem[], drafts: ResultDrafts): ExamResultItem[] {
  return items.filter((item) => isRecordableItem(item) && drafts.has(item.student.id) && isDraftChanged(item, drafts.get(item.student.id)!))
}

/** The whole new state of one student's result: the score with `scored`, the feedback when not blank. */
export function resultInputOf(studentId: string, draft: ResultDraft): ExamResultInput {
  const next = normaliseDraft(draft)
  if (!next.status) throw new Error(`No status chosen for ${studentId}`)
  const result: ExamResultInput = { studentId, status: next.status }
  if (next.score !== null) result.score = next.score
  if (next.feedback !== null) result.feedback = next.feedback
  return result
}

/** The one PUT body (API-120) for the changed rows, or null when nothing changed. */
export function planResultsSave(items: readonly ExamResultItem[], drafts: ResultDrafts): RecordExamResultsInput | null {
  const results = changedItems(items, drafts).map((item) => resultInputOf(item.student.id, drafts.get(item.student.id)!))
  return results.length > 0 ? { results } : null
}

/** True when the batch is larger than the server accepts in one request. */
export function isBatchTooLarge(input: RecordExamResultsInput): boolean {
  return input.results.length > RESULTS_BATCH_MAX
}

/** The draft after choosing a status: leaving `scored` drops the score (the server refuses one with `absent` or `excused`). */
export function withStatus(draft: ResultDraft, status: ExamResultStatus): ResultDraft {
  return { ...draft, status, score: status === 'scored' ? draft.score : null }
}
