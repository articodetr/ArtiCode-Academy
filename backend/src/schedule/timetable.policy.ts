// Pure rules of the timetable readings of MOD-07-T04 (roadmap §4e.5 T04,
// D-R27), unit-tested in timetable.policy.spec.ts:
//   - the academy schedule (`GET /api/schedule`) is read by holders of
//     `schedule.manage` OR `classes.manage` — the global guard checks
//     "every listed key", so the any-of rule lives here;
//   - «my schedule» (`GET /api/me/schedule`) needs `schedule.read` and shows,
//     by ownership, the slots of the classes the caller is enrolled in
//     (`self`), of the classes their linked children are enrolled in while
//     the caller holds the `guardian` role (`child` — the T05 rule), and of
//     the classes the caller teaches, lead or assistant (`teacher`);
//   - a slot is "effective on" a calendar date when the date lies inside
//     `effective_from`..`effective_to` (inclusive, open end);
//   - every slot is displayed in the time zone of its room's branch, else the
//     academy's (§4e.8 (4)).
import { MANAGE_CLASSES_PERMISSION } from '../classes/classes.policy.js';
import type { MyClassRelation } from '../enrollments/my-classes.policy.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MANAGE_SCHEDULE_PERMISSION } from './schedule.policy.js';
import { calendarDateToColumn } from './schedule.time.js';

/** Either key opens the academy schedule (D-R27 (أ)). */
export const ACADEMY_SCHEDULE_PERMISSIONS: readonly string[] = [MANAGE_SCHEDULE_PERMISSION, MANAGE_CLASSES_PERMISSION];

/** `branchId=none` in the academy schedule = the slots held in rooms without a branch (the academy's own site). */
export const NO_BRANCH_FILTER = 'none';

/**
 * The keys to report as missing when the caller holds neither
 * `schedule.manage` nor `classes.manage`; null when one of them is held.
 */
export function academyScheduleMissing(permissions: readonly string[]): string[] | null {
  return ACADEMY_SCHEDULE_PERMISSIONS.some((key) => permissions.includes(key)) ? null : [...ACADEMY_SCHEDULE_PERMISSIONS];
}

/** Prisma filter: the slot is effective on the calendar date (`YYYY-MM-DD`). */
export function effectiveOnWhere(on: string): Prisma.ClassScheduleWhereInput {
  const day = calendarDateToColumn(on);
  return { effectiveFrom: { lte: day }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }] };
}

export interface AcademyScheduleFilters {
  branchId?: string;
  roomId?: string;
  teacherUserId?: string;
  classId?: string;
  weekday?: number;
}

/**
 * The ANDed filters of the academy schedule: every given id narrows the list
 * (an unknown id simply matches nothing), `branchId=none` keeps the slots of
 * the academy's own site (rooms without a branch), and the slot must be
 * effective on `on`. Slots without a room never match a `branchId` filter.
 */
export function academyScheduleWhere(filters: AcademyScheduleFilters, on: string): Prisma.ClassScheduleWhereInput {
  const where: Prisma.ClassScheduleWhereInput = { ...effectiveOnWhere(on) };
  if (filters.branchId !== undefined) where.room = { branchId: filters.branchId === NO_BRANCH_FILTER ? null : filters.branchId };
  if (filters.roomId !== undefined) where.roomId = filters.roomId;
  if (filters.teacherUserId !== undefined) where.teacherUserId = filters.teacherUserId;
  if (filters.classId !== undefined) where.classId = filters.classId;
  if (filters.weekday !== undefined) where.weekday = filters.weekday;
  return where;
}

/** The time zone a slot is displayed in: its room's branch when the branch has one, else the academy's. */
export function displayTimeZone(branchTimeZone: string | null | undefined, academyTimeZone: string): string {
  return branchTimeZone ?? academyTimeZone;
}

export type MyScheduleRelation = MyClassRelation | 'teacher';

const RELATION_ORDER: Record<MyScheduleRelation, number> = { self: 0, child: 1, teacher: 2 };

export interface OwnedStudent {
  id: string;
  fullName: string;
  displayName: string | null;
}

/** One reason the caller may see a class's slots. */
export interface ScheduleOwnership {
  classId: string;
  relation: MyScheduleRelation;
  /** The enrolled student for `self` (the caller) and `child`; null for `teacher`. */
  student: OwnedStudent | null;
}

export interface OwnedSlotLike {
  id: string;
  classId: string;
}

/** `self` → `child` → `teacher`, then by the student's id — the order of the ownerships of one slot. */
export function compareOwnerships(a: ScheduleOwnership, b: ScheduleOwnership): number {
  return RELATION_ORDER[a.relation] - RELATION_ORDER[b.relation] || (a.student?.id ?? '').localeCompare(b.student?.id ?? '');
}

/**
 * «My schedule» shows one item per (slot × ownership): a guardian with two
 * children in one class sees that class's slot twice, once per child; a
 * caller who both teaches a class and has a child enrolled in it sees its
 * slots as `teacher` and as `child`. The same ownership is never repeated
 * (a student enrolled once appears once). Slots keep the order they are
 * given in (the query orders them by weekday, start time, id) and a slot of
 * a class nobody owns is dropped; within one slot the items follow
 * `compareOwnerships()`.
 */
export function expandOwnership<T extends OwnedSlotLike>(slots: readonly T[], ownerships: readonly ScheduleOwnership[]): Array<{ slot: T; ownership: ScheduleOwnership }> {
  const seen = new Set<string>();
  const byClass = new Map<string, ScheduleOwnership[]>();
  for (const ownership of ownerships) {
    const key = `${ownership.classId}|${ownership.relation}|${ownership.student?.id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byClass.get(ownership.classId) ?? [];
    list.push(ownership);
    byClass.set(ownership.classId, list);
  }
  for (const list of byClass.values()) list.sort(compareOwnerships);
  const items: Array<{ slot: T; ownership: ScheduleOwnership }> = [];
  for (const slot of slots) for (const ownership of byClass.get(slot.classId) ?? []) items.push({ slot, ownership });
  return items;
}
