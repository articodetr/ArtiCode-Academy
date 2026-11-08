// «My lessons» of MOD-06-T04 (roadmap §4f.5 T04, API-101; owner decision
// D-R32: ownership instead of a permission key) as pure rules, unit-tested
// in my-lessons.policy.spec.ts. A user sees the lessons of the classes they
// are enrolled in — now (`active`) or finished (`completed`) — as `self`,
// and, while they hold the `guardian` role, the lessons of the classes their
// linked, not soft-deleted children are enrolled in as `child` (the API-060
// rule: links alone grant nothing). Withdrawn or cancelled enrollments show
// nothing; nobody sees a roster, another student's attendance, the teacher's
// note or the cancellation reason.
import { relationOf, seesChildren } from '../enrollments/my-classes.policy.js';
import type { MyClassRelation } from '../enrollments/my-classes.policy.js';
import type { EnrollmentStatus, Prisma } from '../generated/prisma/client.js';

/** Enrollments that make the caller see a class's lessons (D-R32; «my schedule» uses `active` alone, «my classes» the same two). */
export const MY_LESSONS_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = ['active', 'completed'];

export interface OwnedLessonStudent {
  id: string;
  fullName: string;
  displayName: string | null;
}

/** One reason the caller may see a class's lessons: an owned enrollment of `student` in `classId`. */
export interface LessonOwnership {
  classId: string;
  relation: MyClassRelation;
  student: OwnedLessonStudent;
}

/**
 * Prisma filter of the enrollments the caller owns: their own (`self`), plus
 * their linked, not soft-deleted children's while they hold the `guardian`
 * role (`child`); `active` or `completed` only; optionally narrowed to one
 * student (a student the caller does not own simply matches nothing).
 */
export function ownedEnrollmentsWhere(caller: { id: string; roles: readonly string[] }, studentId?: string): Prisma.EnrollmentWhereInput {
  const owned: Prisma.EnrollmentWhereInput[] = [{ studentUserId: caller.id }];
  if (seesChildren(caller.roles)) owned.push({ student: { deletedAt: null, guardians: { some: { guardianUserId: caller.id } } } });
  const where: Prisma.EnrollmentWhereInput = { status: { in: [...MY_LESSONS_ENROLLMENT_STATUSES] }, OR: owned };
  if (studentId !== undefined) where.studentUserId = studentId;
  return where;
}

/** The ownership an owned enrollment row grants. */
export function ownershipOf(row: { classId: string; studentUserId: string; student: OwnedLessonStudent }, callerId: string): LessonOwnership {
  return { classId: row.classId, relation: relationOf(row.studentUserId, callerId), student: row.student };
}

const RELATION_ORDER: Record<MyClassRelation, number> = { self: 0, child: 1 };

/** `self` before `child`, then by the student's id — the order of the items of one lesson. */
export function compareLessonOwnerships(a: LessonOwnership, b: LessonOwnership): number {
  return RELATION_ORDER[a.relation] - RELATION_ORDER[b.relation] || a.student.id.localeCompare(b.student.id);
}

/** The distinct class ids of the ownerships, optionally narrowed to one class. */
export function ownedClassIds(ownerships: readonly LessonOwnership[], classId?: string): string[] {
  const ids = [...new Set(ownerships.map((ownership) => ownership.classId))];
  return classId === undefined ? ids : ids.filter((id) => id === classId);
}

/**
 * One item per (lesson × ownership): a guardian with two children in one
 * class sees that class's lesson twice, once per child; the same ownership
 * is never repeated (a student enrolled once appears once). Lessons keep the
 * order they are given in (the page order — start time, then id); inside one
 * lesson the items follow `compareLessonOwnerships()`; a lesson of a class
 * nobody owns is dropped.
 */
export function expandLessonOwnership<T extends { classId: string }>(lessons: readonly T[], ownerships: readonly LessonOwnership[]): Array<{ lesson: T; ownership: LessonOwnership }> {
  const seen = new Set<string>();
  const byClass = new Map<string, LessonOwnership[]>();
  for (const ownership of ownerships) {
    const key = `${ownership.classId}|${ownership.relation}|${ownership.student.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byClass.get(ownership.classId) ?? [];
    list.push(ownership);
    byClass.set(ownership.classId, list);
  }
  for (const list of byClass.values()) list.sort(compareLessonOwnerships);
  const items: Array<{ lesson: T; ownership: LessonOwnership }> = [];
  for (const lesson of lessons) for (const ownership of byClass.get(lesson.classId) ?? []) items.push({ lesson, ownership });
  return items;
}
