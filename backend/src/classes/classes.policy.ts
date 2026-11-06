// Permission keys of MOD-05 as seeded in permission-catalog.ts (no new keys —
// roadmap §4d.3). Visibility follows D-R16: `classes.manage` (staff and
// academy_admin by seed) sees and writes every class; `classes.read` alone
// (teachers by seed) sees only the classes the user is assigned to in
// `class_teachers`. Students and guardians hold neither key: they read their
// own classes through `GET /api/me/classes` (T05).
import type { AuthPrincipal } from '../auth/principal.js';
import type { Prisma } from '../generated/prisma/client.js';

export const READ_CLASSES_PERMISSION = 'classes.read';
export const MANAGE_CLASSES_PERMISSION = 'classes.manage';
/** `PUT /api/classes/:id/teachers` (T03). */
export const ASSIGN_CLASS_TEACHERS_PERMISSION = 'classes.teachers.assign';
/** Class rosters (T04): holders of `enrollments.manage`, or a teacher assigned to the class. */
export const READ_ENROLLMENTS_PERMISSION = 'enrollments.read';
/** Enrolling students and enrollment actions (T04). */
export const MANAGE_ENROLLMENTS_PERMISSION = 'enrollments.manage';

/** System role a class teacher must actually hold (a `user_roles` row — T03). */
export const TEACHER_ROLE_KEY = 'teacher';
/** System role an enrolled student must actually hold (T04). */
export const STUDENT_ROLE_KEY = 'student';
/** Account states that may be assigned to a class or enrolled (4d.7: suspended/archived → user_not_eligible). */
export const ELIGIBLE_USER_STATUSES = ['invited', 'active'] as const;

/** True when the caller sees every class, not only the assigned ones. */
export function canManageClasses(permissions: readonly string[]): boolean {
  return permissions.includes(MANAGE_CLASSES_PERMISSION);
}

/**
 * D-R16 as a Prisma filter: without `classes.manage` only the classes the
 * caller is assigned to (lead or assistant). Shared by the classes queries and
 * the class schedule reads of MOD-07 (moved here from classes.service.ts in
 * MOD-07-T03 so both modules use one rule).
 */
export function visibleClassesWhere(caller: Pick<AuthPrincipal, 'id' | 'permissions'>): Prisma.ClassWhereInput {
  return canManageClasses(caller.permissions) ? {} : { teachers: { some: { teacherUserId: caller.id } } };
}
