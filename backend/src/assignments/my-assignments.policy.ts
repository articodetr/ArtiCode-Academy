// «My assignments» of MOD-08-T04 (roadmap §4g.4 API-112; owner decision D-R40:
// ownership instead of a permission key, as «my lessons» — D-R32) as pure
// rules, unit-tested in my-assignments.policy.spec.ts. The ownerships come
// from lessons/my-lessons.policy.ts (the caller's `active`/`completed`
// enrollments as `self`, and their linked, not soft-deleted children's while
// they hold the `guardian` role as `child`); a draft is never shown.
import type { AssignmentStatus, Prisma, SubmissionStatus } from '../generated/prisma/client.js';
import type { LessonOwnership } from '../lessons/my-lessons.policy.js';

/** The statuses a learner sees: drafts are the teacher's (D-R37); `grading`/`graded` are unused. */
export const MY_ASSIGNMENT_STATUSES = ['open', 'closed'] as const satisfies readonly AssignmentStatus[];
export type MyAssignmentStatus = (typeof MY_ASSIGNMENT_STATUSES)[number];

/**
 * `pending=true`: the assignments where at least one owned student of the
 * class has not submitted yet (one OR branch per ownership), plus — since
 * MOD-08-T07 (D-R49) — those where an owned student's latest attempt was
 * returned for rework (`reworkAssignmentIds`, from `awaitingRework()`); the
 * items that are not pending (`isPendingItem()`) are dropped after the expansion.
 */
export function pendingWhere(ownerships: readonly Pick<LessonOwnership, 'classId' | 'student'>[], reworkAssignmentIds: readonly string[] = []): Prisma.AssignmentWhereInput {
  const none: Prisma.AssignmentWhereInput[] = ownerships.map((ownership) => ({ classId: ownership.classId, submissions: { none: { studentUserId: ownership.student.id } } }));
  return { OR: reworkAssignmentIds.length > 0 ? [...none, { id: { in: [...reworkAssignmentIds] } }] : none };
}

export interface OwnedAttempt {
  assignmentId: string;
  classId: string;
  studentUserId: string;
  attemptNo: number;
  status: SubmissionStatus;
}

/**
 * The assignments where an owned student's latest attempt is `returned` —
 * the work waits for them again. Attempts of a student who is not owned in
 * that assignment's class never count.
 */
export function awaitingRework(attempts: readonly OwnedAttempt[], ownerships: readonly Pick<LessonOwnership, 'classId' | 'student'>[]): string[] {
  const owned = new Set(ownerships.map((ownership) => `${ownership.classId}|${ownership.student.id}`));
  const latest = new Map<string, OwnedAttempt>();
  for (const attempt of attempts) {
    if (!owned.has(`${attempt.classId}|${attempt.studentUserId}`)) continue;
    const key = `${attempt.assignmentId}|${attempt.studentUserId}`;
    const current = latest.get(key);
    if (!current || attempt.attemptNo > current.attemptNo) latest.set(key, attempt);
  }
  return [...new Set([...latest.values()].filter((attempt) => attempt.status === 'returned').map((attempt) => attempt.assignmentId))];
}

/** A pending item: no attempt yet, or the latest one returned with an attempt left. */
export function isPendingItem(latestStatus: SubmissionStatus | null, attempts: number, attemptsAllowed: number): boolean {
  if (latestStatus === null) return true;
  return latestStatus === 'returned' && attempts < attemptsAllowed;
}
