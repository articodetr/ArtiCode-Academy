// "My classes" of MOD-05-T05 (D-R16: ownership, no permission key) as pure
// rules, unit-tested in my-classes.policy.spec.ts. A user sees the
// enrollments where they are the student (`self`) and, while they hold the
// `guardian` role, the enrollments of the students linked to them in
// `guardian_students` (`child`) — nobody else's, and never a roster.
import type { EnrollmentStatus } from '../generated/prisma/client.js';
import { GUARDIAN_ROLE_KEY } from '../guardians/guardians.policy.js';

/** Without a `status` filter the list shows current and finished classes, not withdrawn or cancelled ones. */
export const MY_CLASSES_DEFAULT_STATUSES: readonly EnrollmentStatus[] = ['active', 'completed'];

export type MyClassRelation = 'self' | 'child';

/** The enrollment statuses to read: the one asked for, or the defaults. */
export function myClassStatuses(filter: EnrollmentStatus | undefined): EnrollmentStatus[] {
  return filter ? [filter] : [...MY_CLASSES_DEFAULT_STATUSES];
}

/**
 * Owner decision (issue #19, 2026-11-04): the children's classes are shown
 * only while the caller holds the `guardian` role. Links left in
 * `guardian_students` after the role was taken away grant nothing.
 */
export function seesChildren(roleKeys: readonly string[]): boolean {
  return roleKeys.includes(GUARDIAN_ROLE_KEY);
}

/** `self` when the caller is the enrolled student, `child` for a linked student. */
export function relationOf(studentUserId: string, callerId: string): MyClassRelation {
  return studentUserId === callerId ? 'self' : 'child';
}
