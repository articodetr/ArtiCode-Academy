// "My classes" of MOD-05-T05 (D-R16: ownership, no permission key) as pure
// rules, unit-tested in my-classes.policy.spec.ts. A user sees the
// enrollments where they are the student (`self`) and the enrollments of the
// students linked to them in `guardian_students` as guardian (`child`) —
// nobody else's, and never a roster.
import type { EnrollmentStatus } from '../generated/prisma/client.js';

/** Without a `status` filter the list shows current and finished classes, not withdrawn or cancelled ones. */
export const MY_CLASSES_DEFAULT_STATUSES: readonly EnrollmentStatus[] = ['active', 'completed'];

export type MyClassRelation = 'self' | 'child';

/** The enrollment statuses to read: the one asked for, or the defaults. */
export function myClassStatuses(filter: EnrollmentStatus | undefined): EnrollmentStatus[] {
  return filter ? [filter] : [...MY_CLASSES_DEFAULT_STATUSES];
}

/** `self` when the caller is the enrolled student, `child` for a linked student. */
export function relationOf(studentUserId: string, callerId: string): MyClassRelation {
  return studentUserId === callerId ? 'self' : 'child';
}
