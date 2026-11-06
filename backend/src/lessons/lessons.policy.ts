// Permission keys and visibility of MOD-06 lessons (roadmap §4f.3, D-R32) as
// seeded in permission-catalog.ts — no new keys. Visibility follows D-R16
// through the class: `classes.manage` sees the lessons of every class,
// anyone else only those of the classes they are assigned to in
// `class_teachers` (others are 404). Writing needs `lessons.manage` and the
// same visibility: a teacher writes in the classes they teach (lead or
// assistant), a holder of `classes.manage` + `lessons.manage` anywhere.
// Students and guardians read their own lessons through `GET /api/me/lessons`
// (T04) — `lessons.read` alone opens nothing to them because they are not
// assigned to any class.
import type { AuthPrincipal } from '../auth/principal.js';
import { canManageClasses, visibleClassesWhere } from '../classes/classes.policy.js';
import type { ClassStatus, Prisma } from '../generated/prisma/client.js';

export const READ_LESSONS_PERMISSION = 'lessons.read';
export const MANAGE_LESSONS_PERMISSION = 'lessons.manage';
/** T03: the attendance sheet of a lesson. */
export const READ_ATTENDANCE_PERMISSION = 'attendance.read';
/** T03: recording and correcting attendance. */
export const RECORD_ATTENDANCE_PERMISSION = 'attendance.record';

/** A lesson is created or edited for a class in one of these states; completed/cancelled classes freeze their lessons (D-R33 (1)). */
export const LESSON_OPEN_CLASS_STATUSES: readonly ClassStatus[] = ['planned', 'open', 'running'];

/** D-R16 through the class: the lessons the caller may see (and, with `lessons.manage`, write). */
export function visibleLessonsWhere(caller: Pick<AuthPrincipal, 'id' | 'permissions'>): Prisma.LessonWhereInput {
  return canManageClasses(caller.permissions) ? {} : { class: visibleClassesWhere(caller) };
}

/** True when the caller sees every class's lessons (no assignment check needed). */
export function seesEveryClass(caller: Pick<AuthPrincipal, 'permissions'>): boolean {
  return canManageClasses(caller.permissions);
}

/** True when lessons of a class in this status may be created or edited. */
export function isClassOpenForLessons(status: ClassStatus): boolean {
  return LESSON_OPEN_CLASS_STATUSES.includes(status);
}
