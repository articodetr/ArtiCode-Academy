// Permission keys and visibility of MOD-09 exams (roadmap §4h.3, D-R48) as
// seeded in permission-catalog.ts — no new keys. Visibility follows D-R16
// through the class: `classes.manage` sees the exams of every class, anyone
// else only those of the classes they are assigned to in `class_teachers`
// (others are 404). Writing needs `exams.manage`, recording results
// `exams.grade`, both with the same visibility. Students and guardians read
// their own exams through `GET /api/me/exams` (T04) — `exams.read` alone opens
// nothing to them because they are not assigned to any class. Since the
// second phase (roadmap §4r) `exams.take` — seeded to students — lets a
// learner start, answer and submit their OWN attempt at an online exam of a
// class they are actively enrolled in, and `questions.manage` governs the
// question banks (questions/questions.policy.ts).
import type { AuthPrincipal } from '../auth/principal.js';
import { canManageClasses, visibleClassesWhere } from '../classes/classes.policy.js';
import type { ClassStatus, Prisma } from '../generated/prisma/client.js';

export const READ_EXAMS_PERMISSION = 'exams.read';
export const MANAGE_EXAMS_PERMISSION = 'exams.manage';
/** T04: recording the results sheet; phase 2: correcting a key and regrading. */
export const GRADE_EXAMS_PERMISSION = 'exams.grade';
/** Phase 2: starting, answering and submitting one's own attempt at an online exam. */
export const TAKE_EXAMS_PERMISSION = 'exams.take';

/** A new exam is created for a class in one of these states (as assignments — §4h.8 (7)). */
export const EXAM_CREATE_CLASS_STATUSES: readonly ClassStatus[] = ['planned', 'open', 'running'];

/** D-R16 through the class: the exams the caller may see (and, with the write keys, write). */
export function visibleExamsWhere(caller: Pick<AuthPrincipal, 'id' | 'permissions'>): Prisma.ExamWhereInput {
  return canManageClasses(caller.permissions) ? {} : { class: visibleClassesWhere(caller) };
}

/** True when the caller sees every class's exams. */
export function seesEveryClass(caller: Pick<AuthPrincipal, 'permissions'>): boolean {
  return canManageClasses(caller.permissions);
}

/** A new exam needs a planned, open or running class. */
export function isClassOpenForNewExam(status: ClassStatus): boolean {
  return EXAM_CREATE_CLASS_STATUSES.includes(status);
}

/**
 * An existing exam of a cancelled class takes no edit, no `schedule`/`publish`
 * and no result; a completed class keeps its exams open for corrections
 * (the D-R33 pattern — grading happens after the last lesson).
 */
export function isClassFrozenForExams(status: ClassStatus): boolean {
  return status === 'cancelled';
}
