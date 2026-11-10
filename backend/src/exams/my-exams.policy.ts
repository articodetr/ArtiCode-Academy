// «My exams» of MOD-09-T04 (roadmap §4h.4 API-121; owner decision D-R48:
// ownership instead of a permission key, as «my assignments» — D-R40) as
// pure rules, unit-tested in my-exams.policy.spec.ts. The ownerships come from
// lessons/my-lessons.policy.ts (the caller's `active`/`completed` enrollments
// as `self`, and their linked, not soft-deleted children's while they hold the
// `guardian` role as `child`); a draft is never shown and a result only once
// the exam's results are published (D-R47).
import type { ExamResultStatus, ExamStatus } from '../generated/prisma/client.js';

/** The statuses a learner sees: a draft is the teacher's (D-R47). */
export const MY_EXAM_STATUSES = ['scheduled', 'published'] as const satisfies readonly ExamStatus[];
export type MyExamStatus = (typeof MY_EXAM_STATUSES)[number];

export interface MyExamResultView {
  status: ExamResultStatus;
  score: number | null;
  feedback: string | null;
}

/** The student's own result as a learner may see it: nothing before the results are published. */
export function visibleResult(examStatus: ExamStatus, result: MyExamResultView | null): MyExamResultView | null {
  return examStatus === 'published' ? result : null;
}
