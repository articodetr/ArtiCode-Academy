// Review rules of the submissions tab (J-F41): a manual mirror of the review
// half of backend/src/assignments/submissions.policy.ts — REVIEW_ACTIONS,
// reviewTarget(), sameReview(), isScoreInRange(), the D-R39 attempt rule of
// summarizeAttempts() and the closing rules of submissionWindow() — and of
// ReviewSubmissionDto (submissions.dto.ts: a score with `grade` only, a JSON
// number with at most two decimals; feedback trimmed, blank = absent, required
// with `return`). Keep it in sync with backend/src/assignments/submissions.policy.ts.
// The server stays the boundary (400 score_out_of_range / feedback_required,
// 404 submission_not_found).
//
//   grade   any attempt, from any status (submitted / graded / returned) → graded,
//           with a score 0..maxScore and the feedback as typed: a blank feedback
//           clears the previous one; repeatable (a correction); also for a closed
//           assignment or a completed class (D-R39, roadmap §4g.8 (3))
//   return  any attempt, from any status → returned, with a mandatory feedback; the
//           score is cleared; the student gets one more attempt (attemptsAllowed =
//           maxAttempts + the returned attempts) — usable only while API-109 takes
//           submissions: an open assignment, before its due date or with allowLate
//   same    a review equal to the stored state writes nothing on the server, so the
//           panel sends nothing
//   seen    every review sent carries the review the grader saw (`expectedGradedAt` =
//           the submission's `gradedAt`, null before any review — D-R49, the mirror of
//           reviewVersionMatches()): a review written meanwhile by someone else is
//           409 `review_conflict`, never overwritten silently
//
// Grading a returned attempt takes back the attempt its return granted. Pure;
// unit-tested in submissions.status.test.ts.
import { REVIEW_ACTIONS } from '../api/submissions'
import type { ReviewAction, ReviewSubmissionInput, Submission, SubmissionAssignment, SubmissionStatus } from '../api/submissions'
import { isTwoDecimalNumber } from './assignments.validation'

/** The whole review state an action writes; the score as numeric text with two decimals, as the server compares it. */
export interface ReviewState {
  status: SubmissionStatus
  score: string | null
  feedback: string | null
}

/** What the grading form holds. */
export interface ReviewDraft {
  action: ReviewAction
  score?: number | null
  feedback?: string
}

/** Numeric text with two decimals, or null — the server's toDecimalText(). */
export function toDecimalText(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : Number(value).toFixed(2)
}

/** The feedback as the server stores it: trimmed, a blank text is absent (textParam). */
export function normalizeFeedback(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length === 0 ? null : trimmed
}

/** Both actions on any attempt of any status for a holder of `assignments.grade`; the class visibility is the server's. */
export function availableReviewActions(canGrade: boolean): ReviewAction[] {
  return canGrade ? [...REVIEW_ACTIONS] : []
}

/** The review state an action writes (mirror of reviewTarget()). */
export function reviewTarget(action: ReviewAction, score: string | null, feedback: string | null): ReviewState {
  return action === 'grade' ? { status: 'graded', score, feedback } : { status: 'returned', score: null, feedback }
}

/** True when the review would write nothing new (an identical re-grade or re-return — mirror of sameReview()). */
export function sameReview(current: ReviewState, next: ReviewState): boolean {
  return current.status === next.status && current.score === next.score && current.feedback === next.feedback
}

/** 0 ≤ score ≤ max score (mirror of isScoreInRange()). */
export function isScoreInRange(score: number, maxScore: number): boolean {
  return score >= 0 && score <= maxScore
}

/** A score `grade` accepts: a finite number with at most two decimals within 0..maxScore. */
export function isScoreValid(value: unknown, maxScore: number): value is number {
  return isTwoDecimalNumber(value) && isScoreInRange(value, maxScore)
}

/** The stored review state of a submission. */
export function reviewStateOf(submission: Pick<Submission, 'status' | 'score' | 'feedback'>): ReviewState {
  return { status: submission.status, score: toDecimalText(submission.score), feedback: submission.feedback }
}

/** The grading form's first values: the stored review, so an untouched form sends nothing (a waiting attempt starts as an empty grade). */
export function reviewDraftOf(submission: Pick<Submission, 'status' | 'score' | 'feedback'>): ReviewDraft {
  if (submission.status === 'returned') return { action: 'return', score: null, feedback: submission.feedback ?? '' }
  return { action: 'grade', score: submission.score, feedback: submission.feedback ?? '' }
}

/**
 * True when the form holds something its first values do not — a typed feedback, a score or another action.
 * `current` is the whole form store (`getFieldsValue(true)`): the score field unmounts while `return` is chosen
 * but keeps its value, which comes back with `grade`.
 */
export function isReviewDraftDirty(initial: ReviewDraft, current: Partial<ReviewDraft>): boolean {
  const score = (draft: Partial<ReviewDraft>) => (typeof draft.score === 'number' ? draft.score : null)
  return (current.action ?? initial.action) !== initial.action || score(current) !== score(initial) || normalizeFeedback(current.feedback) !== normalizeFeedback(initial.feedback)
}

export type ReviewPlan =
  /** The smallest API-111 body. */
  | { kind: 'send'; body: ReviewSubmissionInput }
  /** The review equals the stored state: nothing to send. */
  | { kind: 'unchanged' }
  /** A rule of the DTO or the service would refuse it (the form's own rules word it first). */
  | { kind: 'invalid'; field: 'score' | 'feedback' }

/**
 * The request for the draft, in the server's order: `return` without feedback
 * (`feedback_required`), a `grade` score outside 0..maxScore or with more than
 * two decimals (`score_out_of_range` / 400), then an identical review (nothing
 * written). The body is the smallest one: `{ action: 'grade', score }` plus the
 * feedback when it is not blank — absent clears the previous one — or
 * `{ action: 'return', feedback }`; never a score with `return`. Every body
 * ends with `expectedGradedAt`: the `gradedAt` of the submission the grader
 * saw, null when it had no review yet (D-R49).
 */
export function planReview(submission: Pick<Submission, 'status' | 'score' | 'feedback' | 'gradedAt' | 'assignment'>, draft: ReviewDraft): ReviewPlan {
  const feedback = normalizeFeedback(draft.feedback)
  const current = reviewStateOf(submission)
  const expectedGradedAt = submission.gradedAt
  if (draft.action === 'return') {
    if (feedback === null) return { kind: 'invalid', field: 'feedback' }
    if (sameReview(current, reviewTarget('return', null, feedback))) return { kind: 'unchanged' }
    return { kind: 'send', body: { action: 'return', feedback, expectedGradedAt } }
  }
  if (!isScoreValid(draft.score, submission.assignment.maxScore)) return { kind: 'invalid', field: 'score' }
  if (sameReview(current, reviewTarget('grade', toDecimalText(draft.score), feedback))) return { kind: 'unchanged' }
  return {
    kind: 'send',
    body: feedback === null ? { action: 'grade', score: draft.score, expectedGradedAt } : { action: 'grade', score: draft.score, feedback, expectedGradedAt },
  }
}

export interface ReviewEffects {
  /** `return` on an attempt that is not returned yet: the student gets one more attempt (D-R39). */
  grantsAttempt: boolean
  /** `return` on a graded attempt: its score is cleared. */
  clearsScore: boolean
  /** `grade` on a returned attempt: the attempt its return granted is taken back (attemptsAllowed counts the returned attempts). */
  withdrawsAttempt: boolean
}

export function reviewEffects(current: SubmissionStatus, action: ReviewAction): ReviewEffects {
  return {
    grantsAttempt: action === 'return' && current !== 'returned',
    clearsScore: action === 'return' && current === 'graded',
    withdrawsAttempt: action === 'grade' && current === 'returned',
  }
}

/** Why the attempt a `return` grants may stay unusable. */
export type ReturnCaveat = 'closed' | 'noLate'

/**
 * What submissionWindow() tells without a clock: an assignment that is not
 * `open` takes no submission (`assignment_closed { reason: closed }`), and one
 * with a due date but without allowLate takes none after it (`past_due`). The
 * panel says so when a teacher returns work, since the contract accepts a
 * return in both cases (D-R39) — whether the due date has passed is never
 * decided from this device's clock. The submission's own assignment carries
 * its late policy (`allowLate`, MOD-08-T07).
 */
export function returnCaveats(assignment: Pick<SubmissionAssignment, 'status' | 'dueAt' | 'allowLate'>): ReturnCaveat[] {
  const caveats: ReturnCaveat[] = []
  if (assignment.status !== 'open') caveats.push('closed')
  if (assignment.dueAt !== null && !assignment.allowLate) caveats.push('noLate')
  return caveats
}
