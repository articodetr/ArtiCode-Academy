// Submission rules of MOD-08-T03 (roadmap §4g.4 API-108..API-111; owner
// decisions D-R35/D-R38/D-R39) as pure functions, unit-tested in
// submissions.policy.spec.ts:
//
//   window    an `open` assignment takes submissions; before `due_at` on time,
//             after it only with `allow_late` (marked late) — D-R38
//   attempts  one row per attempt; `max_attempts` plus one per returned attempt
//             (D-R39: returning work for rework grants one more attempt)
//   review    `grade` → graded with a score (0..max_score) and optional feedback,
//             repeatable; `return` → returned with feedback and no score; any
//             attempt of any status may be reviewed, also of a closed assignment
import type { AssignmentStatus, EnrollmentStatus, SubmissionStatus } from '../generated/prisma/client.js';
import type { AssignmentClosedReason } from './assignments.errors.js';

/** The roster of an assignment lists these enrollments, plus anyone holding a submission (a withdrawn student keeps it). */
export const SUBMISSION_ROSTER_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = ['active', 'completed'];

/** Only an `active` enrollment submits (a completed or withdrawn student no longer does). */
export const SUBMITTING_ENROLLMENT_STATUS: EnrollmentStatus = 'active';

export const REVIEW_ACTIONS = ['grade', 'return'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export type SubmissionWindow = { closed: AssignmentClosedReason } | { isLate: boolean };

/** Whether the assignment takes a submission now, and whether it is late. */
export function submissionWindow(status: AssignmentStatus, dueAt: Date | null, allowLate: boolean, now: Date = new Date()): SubmissionWindow {
  if (status === 'draft') return { closed: 'not_published' };
  if (status !== 'open') return { closed: 'closed' };
  const late = dueAt !== null && now.getTime() > dueAt.getTime();
  if (late && !allowLate) return { closed: 'past_due' };
  return { isLate: late };
}

/** A student's attempts on one assignment, in attempt order. */
export interface AttemptRow {
  attemptNo: number;
  status: SubmissionStatus;
  score: string | null;
}

export interface AttemptSummary {
  attempts: number;
  /** `max_attempts` plus one per returned attempt (D-R39). */
  attemptsAllowed: number;
  /** The highest attempt number, or 0 without attempts. */
  lastAttemptNo: number;
  /** The score of the latest graded attempt, as numeric text, or null. */
  lastGradedScore: string | null;
}

export function summarizeAttempts(rows: readonly AttemptRow[], maxAttempts: number): AttemptSummary {
  let lastAttemptNo = 0;
  let lastGraded: AttemptRow | null = null;
  let returned = 0;
  for (const row of rows) {
    if (row.attemptNo > lastAttemptNo) lastAttemptNo = row.attemptNo;
    if (row.status === 'returned') returned += 1;
    if (row.status === 'graded' && (lastGraded === null || row.attemptNo > lastGraded.attemptNo)) lastGraded = row;
  }
  return { attempts: rows.length, attemptsAllowed: maxAttempts + returned, lastAttemptNo, lastGradedScore: lastGraded?.score ?? null };
}

/** The whole review state an action writes. */
export interface ReviewState {
  status: SubmissionStatus;
  /** Numeric text with two decimals, or null. */
  score: string | null;
  feedback: string | null;
}

export function reviewTarget(action: ReviewAction, score: string | null, feedback: string | null): ReviewState {
  return action === 'grade' ? { status: 'graded', score, feedback } : { status: 'returned', score: null, feedback };
}

/** True when the review would write nothing new (an identical re-grade or re-return). */
export function sameReview(current: ReviewState, next: ReviewState): boolean {
  return current.status === next.status && current.score === next.score && current.feedback === next.feedback;
}

/** 0 ≤ score ≤ max score. */
export function isScoreInRange(score: number, maxScore: number): boolean {
  return score >= 0 && score <= maxScore;
}
