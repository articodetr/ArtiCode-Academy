// Permission keys and visibility of MOD-08 assignments (roadmap §4g.3, D-R40)
// as seeded in permission-catalog.ts — no new keys. Visibility follows D-R16
// through the class: `classes.manage` sees the assignments of every class,
// anyone else only those of the classes they are assigned to in
// `class_teachers` (others are 404). Writing needs `assignments.manage` and
// the same visibility. Students and guardians read their own assignments
// through `GET /api/me/assignments` (T04) — `assignments.read` alone opens
// nothing to them because they are not assigned to any class. The seeded
// staff role holds no `assignments.*` key (matrix 7.2).
import type { AuthPrincipal } from '../auth/principal.js';
import { canManageClasses, visibleClassesWhere } from '../classes/classes.policy.js';
import type { ClassStatus, Prisma } from '../generated/prisma/client.js';

export const READ_ASSIGNMENTS_PERMISSION = 'assignments.read';
export const MANAGE_ASSIGNMENTS_PERMISSION = 'assignments.manage';
/** T03: a student submits to an assignment of a class they are actively enrolled in. */
export const SUBMIT_ASSIGNMENTS_PERMISSION = 'assignments.submit';
/** T03: grading and returning submissions. */
export const GRADE_ASSIGNMENTS_PERMISSION = 'assignments.grade';

/** An assignment is created, edited, published or reopened for a class in one of these states (§4g.8 (3)). */
export const ASSIGNMENT_OPEN_CLASS_STATUSES: readonly ClassStatus[] = ['planned', 'open', 'running'];

/** D-R16 through the class: the assignments the caller may see (and, with `assignments.manage`, write). */
export function visibleAssignmentsWhere(caller: Pick<AuthPrincipal, 'id' | 'permissions'>): Prisma.AssignmentWhereInput {
  return canManageClasses(caller.permissions) ? {} : { class: visibleClassesWhere(caller) };
}

/** True when the caller sees every class's assignments (no assignment check needed). */
export function seesEveryClass(caller: Pick<AuthPrincipal, 'permissions'>): boolean {
  return canManageClasses(caller.permissions);
}

/** True when assignments of a class in this status may be created, edited, published or reopened. */
export function isClassOpenForAssignments(status: ClassStatus): boolean {
  return ASSIGNMENT_OPEN_CLASS_STATUSES.includes(status);
}
