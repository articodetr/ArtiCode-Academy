// Pure rules of an attempt at an online exam (MOD-09 phase 2 — roadmap §4r;
// decisions D-R152..D-R157), unit-tested in attempts.policy.spec.ts.
//
//   - The clock is the server's (D-R152). An attempt's deadline is fixed when
//     it starts: the start plus the exam's time limit, never past the end of
//     the window. The browser's timer only displays it.
//   - A write that arrives up to ATTEMPT_GRACE_MS after the deadline is still
//     taken (a last save or the submit itself on a slow network); after that
//     the attempt is closed by the server with what was saved (D-R154).
//   - `takeState()` says whether a learner may start or resume now and, when
//     not, why — computed at the server clock for «my exams» and enforced by
//     the same function when the attempt is started.
//   - A learner sees their own score when the exam's results are published,
//     or at once when the exam releases on submit (D-R156); the correct
//     answers and explanations only when the exam reveals them, the score is
//     visible AND the window has closed — and the network allowance after it
//     has passed too, so no write can still be taken (D-R157): a learner who
//     has finished cannot pass the key to one who is still answering.
import type { ClassStatus, EnrollmentStatus, ExamAttemptStatus, ExamStatus } from '../generated/prisma/client.js';
import { windowStateOf } from './exams.online.js';
import type { ExamDeliveryValue, ExamResultsReleaseValue } from './exams.online.js';

/** A write is accepted up to this long after the attempt's deadline. */
export const ATTEMPT_GRACE_MS = 5_000;

/** The deadline of an attempt that starts now: the time limit, cut at the end of the window. */
export function attemptDeadline(startedAt: Date, durationMinutes: number, closesAt: Date): Date {
  const byLimit = startedAt.getTime() + durationMinutes * 60_000;
  return new Date(Math.min(byLimit, closesAt.getTime()));
}

/** True once the attempt takes no more writes: its deadline plus the network allowance has passed. */
export function isAttemptOver(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime() + ATTEMPT_GRACE_MS;
}

/** Whole seconds left on the official deadline, never negative — what the learner's timer shows. */
export function remainingSeconds(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}

export const TAKE_BLOCKERS = ['not_self', 'not_permitted', 'results_published', 'not_enrolled', 'class_closed', 'not_open_yet', 'closed', 'attempts_exhausted'] as const;
export type TakeBlocker = (typeof TAKE_BLOCKERS)[number];

export interface AttemptState {
  id: string;
  attemptNo: number;
  status: ExamAttemptStatus;
  expiresAt: Date;
}

export interface TakeInput {
  /** `self` for the learner's own exam; a guardian's `child` item never takes. */
  relation: 'self' | 'child';
  /** Whether the learner holds `exams.take` (the route's own key — the guard has already checked it there). */
  mayTake: boolean;
  examStatus: ExamStatus;
  classStatus: ClassStatus;
  /** The learner's enrollment in the exam's class, or null without one. */
  enrollmentStatus: EnrollmentStatus | null;
  scheduledAt: Date | null;
  closesAt: Date | null;
  attemptsAllowed: number;
  /** Every attempt of this learner at this exam. */
  attempts: readonly AttemptState[];
  now: Date;
}

export interface TakeState {
  /** True when the learner may start a new attempt or resume the one in progress. */
  canStart: boolean;
  blocker: TakeBlocker | null;
  /** The attempt in progress whose official deadline has not passed, if any. */
  inProgress: AttemptState | null;
  /** Attempts of any status (an attempt whose time is up counts as used). */
  attemptsUsed: number;
  /** The number a new attempt would get; null when none can start. */
  nextAttemptNo: number | null;
}

/**
 * Whether the learner may take the exam now. The reasons come in a fixed
 * order: not their own item → no `exams.take` → the results are already out
 * → no active enrollment → a cancelled class → (an attempt in progress is
 * resumed whatever follows) → before the window → after it → no attempt left.
 */
export function takeState(input: TakeInput): TakeState {
  const attemptsUsed = input.attempts.length;
  const live = input.attempts.find((attempt) => attempt.status === 'in_progress' && input.now.getTime() < attempt.expiresAt.getTime()) ?? null;
  const blocked = (blocker: TakeBlocker): TakeState => ({ canStart: false, blocker, inProgress: null, attemptsUsed, nextAttemptNo: null });
  if (input.relation !== 'self') return blocked('not_self');
  if (!input.mayTake) return blocked('not_permitted');
  if (input.examStatus === 'published') return blocked('results_published');
  if (input.enrollmentStatus !== 'active') return blocked('not_enrolled');
  if (input.classStatus === 'cancelled') return blocked('class_closed');
  if (live !== null) return { canStart: true, blocker: null, inProgress: live, attemptsUsed, nextAttemptNo: null };
  const window = windowStateOf(input.scheduledAt, input.closesAt, input.now);
  if (window === 'not_open') return blocked('not_open_yet');
  if (window === 'closed') return blocked('closed');
  if (attemptsUsed >= input.attemptsAllowed) return blocked('attempts_exhausted');
  return { canStart: true, blocker: null, inProgress: null, attemptsUsed, nextAttemptNo: attemptsUsed + 1 };
}

export interface ReleaseSettings {
  status: ExamStatus;
  delivery: ExamDeliveryValue;
  resultsRelease: ExamResultsReleaseValue;
  revealAnswers: boolean;
  closesAt: Date | null;
}

/**
 * D-R156 — a learner sees their own result once the exam's results are
 * published; an online exam that releases on submit shows it as soon as it
 * exists. A manual exam keeps the first phase's rule: published only.
 */
export function isResultReleased(exam: Pick<ReleaseSettings, 'status' | 'delivery' | 'resultsRelease'>): boolean {
  return exam.status === 'published' || (exam.delivery === 'online' && exam.resultsRelease === 'on_submit');
}

/**
 * D-R157 — the correct answers and explanations: the exam reveals them, the
 * result is released, and the window has closed long enough that no attempt
 * takes a write any more (every deadline lies at or before the closing, and a
 * write is taken up to ATTEMPT_GRACE_MS after its deadline).
 */
export function isReviewReleased(exam: ReleaseSettings, now: Date): boolean {
  return exam.delivery === 'online' && exam.revealAnswers && isResultReleased(exam) && exam.closesAt !== null && now.getTime() >= exam.closesAt.getTime() + ATTEMPT_GRACE_MS;
}
