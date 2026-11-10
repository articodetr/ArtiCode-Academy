// Permission keys and visibility of MOD-09 exams (roadmap §4h.3, D-R48) as
// seeded in permission-catalog.ts — no new keys. Visibility follows D-R16
// through the class: `classes.manage` sees the exams of every class, anyone
// else only those of the classes they are assigned to in `class_teachers`
// (others are 404). Writing needs `exams.manage`, recording results
// `exams.grade`, both with the same visibility. Students and guardians read
// their own exams through `GET /api/me/exams` (T04) — `exams.read` alone opens
// nothing to them because they are not assigned to any class. `exams.take`
// and `questions.manage` wait for the online exams of the second phase (D-R42).
import type { AuthPrincipal } from '../auth/principal.js';
import { canManageClasses, visibleClassesWhere } from '../classes/classes.policy.js';
import type { ClassStatus, Prisma } from '../generated/prisma/client.js';

export const READ_EXAMS_PERMISSION = 'exams.read';
export const MANAGE_EXAMS_PERMISSION = 'exams.manage';
/** T04: recording the results sheet. */
export const GRADE_EXAMS_PERMISSION = 'exams.grade';

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
