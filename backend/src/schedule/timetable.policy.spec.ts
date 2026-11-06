// TEST-073 (unit) — the pure rules of the timetable readings (MOD-07-T04).
import { describe, expect, it } from 'vitest';
import { academyScheduleMissing, academyScheduleWhere, compareOwnerships, displayTimeZone, effectiveOnWhere, expandOwnership } from './timetable.policy.js';
import type { ScheduleOwnership } from './timetable.policy.js';

const DAY = (value: string) => new Date(`${value}T00:00:00.000Z`);
const student = (id: string) => ({ id, fullName: `Student ${id}`, displayName: null });

describe('academyScheduleMissing', () => {
  it('reports both keys when neither is held, nothing when either one is', () => {
    expect(academyScheduleMissing([])).toEqual(['schedule.manage', 'classes.manage']);
    expect(academyScheduleMissing(['classes.read', 'schedule.read'])).toEqual(['schedule.manage', 'classes.manage']);
    expect(academyScheduleMissing(['schedule.manage'])).toBeNull();
    expect(academyScheduleMissing(['classes.manage'])).toBeNull();
    expect(academyScheduleMissing(['classes.manage', 'schedule.manage'])).toBeNull();
  });
});

describe('academyScheduleWhere', () => {
  it('keeps the slots effective on the date and nothing else without filters', () => {
    expect(academyScheduleWhere({}, '2026-11-10')).toEqual(effectiveOnWhere('2026-11-10'));
    expect(effectiveOnWhere('2026-11-10')).toEqual({
      effectiveFrom: { lte: DAY('2026-11-10') },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: DAY('2026-11-10') } }],
    });
  });

  it('ANDs every given filter; `none` means rooms without a branch, slots without a room never match a branch filter', () => {
    const where = academyScheduleWhere(
      { branchId: 'b1', roomId: 'r1', teacherUserId: 'u1', classId: 'c1', weekday: 3 },
      '2026-01-01',
    );
    expect(where).toMatchObject({ room: { branchId: 'b1' }, roomId: 'r1', teacherUserId: 'u1', classId: 'c1', weekday: 3, effectiveFrom: { lte: DAY('2026-01-01') } });
    expect(academyScheduleWhere({ branchId: 'none' }, '2026-01-01').room).toEqual({ branchId: null });
    expect(academyScheduleWhere({ weekday: 0 }, '2026-01-01')).toMatchObject({ weekday: 0 });
    expect(Object.keys(academyScheduleWhere({ classId: 'c1' }, '2026-01-01')).sort()).toEqual(['OR', 'classId', 'effectiveFrom']);
  });
});

describe('displayTimeZone', () => {
  it('prefers the branch zone and falls back to the academy zone', () => {
    expect(displayTimeZone('Europe/Istanbul', 'UTC')).toBe('Europe/Istanbul');
    expect(displayTimeZone(null, 'Asia/Riyadh')).toBe('Asia/Riyadh');
    expect(displayTimeZone(undefined, 'Asia/Riyadh')).toBe('Asia/Riyadh');
  });
});

describe('expandOwnership', () => {
  const slots = [
    { id: 's1', classId: 'A' },
    { id: 's2', classId: 'B' },
    { id: 's3', classId: 'C' },
  ];

  it('emits one item per slot and ownership, keeps the slot order and drops unowned slots', () => {
    const ownerships: ScheduleOwnership[] = [
      { classId: 'B', relation: 'teacher', student: null },
      { classId: 'A', relation: 'self', student: student('me') },
    ];
    expect(expandOwnership(slots, ownerships).map(({ slot, ownership }) => [slot.id, ownership.relation])).toEqual([
      ['s1', 'self'],
      ['s2', 'teacher'],
    ]);
  });

  it('orders the ownerships of one slot self → child → teacher, then by student id, and never repeats one', () => {
    const ownerships: ScheduleOwnership[] = [
      { classId: 'A', relation: 'teacher', student: null },
      { classId: 'A', relation: 'child', student: student('k2') },
      { classId: 'A', relation: 'child', student: student('k1') },
      { classId: 'A', relation: 'self', student: student('me') },
      { classId: 'A', relation: 'child', student: student('k1') }, // repeated link
      { classId: 'A', relation: 'teacher', student: null }, // repeated assignment
    ];
    expect(expandOwnership(slots, ownerships).map(({ slot, ownership }) => [slot.id, ownership.relation, ownership.student?.id ?? null])).toEqual([
      ['s1', 'self', 'me'],
      ['s1', 'child', 'k1'],
      ['s1', 'child', 'k2'],
      ['s1', 'teacher', null],
    ]);
    expect(compareOwnerships({ classId: 'A', relation: 'child', student: student('x') }, { classId: 'A', relation: 'self', student: student('me') })).toBeGreaterThan(0);
    expect(expandOwnership(slots, [])).toEqual([]);
  });
});
