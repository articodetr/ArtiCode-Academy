// «My exams» of MOD-09-T04 (roadmap §4h.4 API-121; owner decision D-R48:
// ownership instead of a permission key, as «my assignments» — D-R40) as
// pure rules, unit-tested in my-exams.policy.spec.ts. The ownerships come from
// lessons/my-lessons.policy.ts (the caller's `active`/`completed` enrollments
// as `self`, and their linked, not soft-deleted children's while they hold the
// `guardian` role as `child`); a draft is never shown and a result only once
// the exam's results are published (D-R47) — or, for an online exam that
// releases on submit, as soon as it exists (D-R156, attempts.policy.ts).
import type { ExamResultStatus, ExamStatus } from '../generated/prisma/client.js';
import { isResultReleased } from './attempts.policy.js';
import type { ExamDeliveryValue, ExamResultsReleaseValue } from './exams.online.js';

/** The statuses a learner sees: a draft is the teacher's (D-R47). */
export const MY_EXAM_STATUSES = ['scheduled', 'published'] as const satisfies readonly ExamStatus[];
export type MyExamStatus = (typeof MY_EXAM_STATUSES)[number];

export interface MyExamResultView {
  status: ExamResultStatus;
  score: number | null;
  feedback: string | null;
}

/** Where a stored result came from: recorded by the teacher, or the student's counted attempt (D-R160). */
export type ResultSourceValue = 'manual' | 'online';

/**
 * The student's own result as a learner may see it: nothing before the
 * results are published. `online` names the settings of an online exam — one
 * that releases on submit shows the result of an ATTEMPT as soon as it
 * exists (`source: online`); a result the teacher typed for that exam (an
 * absence, an excuse, a make-up on paper, with its feedback) waits for the
 * publication like every recorded result (D-R47). Without `online` the exam
 * is a manual one and keeps the first phase's rule.
 */
export function visibleResult(
  examStatus: ExamStatus,
  result: MyExamResultView | null,
  online?: { delivery: ExamDeliveryValue; resultsRelease: ExamResultsReleaseValue },
  source: ResultSourceValue = 'manual',
): MyExamResultView | null {
  if (examStatus === 'published') return result;
  const released = isResultReleased({ status: examStatus, delivery: online?.delivery ?? 'manual', resultsRelease: online?.resultsRelease ?? 'on_publish' });
  return released && source === 'online' ? result : null;
}
