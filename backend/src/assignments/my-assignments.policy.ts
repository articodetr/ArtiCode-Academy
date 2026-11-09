// «My assignments» of MOD-08-T04 (roadmap §4g.4 API-112; owner decision D-R40:
// ownership instead of a permission key, as «my lessons» — D-R32) as pure
// rules, unit-tested in my-assignments.policy.spec.ts. The ownerships come
// from lessons/my-lessons.policy.ts (the caller's `active`/`completed`
// enrollments as `self`, and their linked, not soft-deleted children's while
// they hold the `guardian` role as `child`); a draft is never shown.
import type { AssignmentStatus, Prisma } from '../generated/prisma/client.js';
import type { LessonOwnership } from '../lessons/my-lessons.policy.js';

/** The statuses a learner sees: drafts are the teacher's (D-R37); `grading`/`graded` are unused. */
export const MY_ASSIGNMENT_STATUSES = ['open', 'closed'] as const satisfies readonly AssignmentStatus[];
export type MyAssignmentStatus = (typeof MY_ASSIGNMENT_STATUSES)[number];

/**
 * `pending=true`: the assignments where at least one owned student of the
 * class has not submitted yet (one OR branch per ownership); the items of the
 * owned students who did submit are dropped after the expansion.
 */
export function pendingWhere(ownerships: readonly Pick<LessonOwnership, 'classId' | 'student'>[]): Prisma.AssignmentWhereInput {
  return { OR: ownerships.map((ownership) => ({ classId: ownership.classId, submissions: { none: { studentUserId: ownership.student.id } } })) };
}
