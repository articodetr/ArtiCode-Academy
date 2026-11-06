// TEST-072 (unit part) — MOD-07-T03 weekly schedule replacement planning,
// request-level conflicts, working days and the time helpers — no database.
import type { ExistingSlot, RequestedSlot, SlotValues } from './schedule.changes.js';
import { findNonWorkingDay, findRequestConflict, planScheduleReplacement, referencedIds, slotsOverlap } from './schedule.changes.js';
import { calendarDateIn, clockRangesOverlap, clockTimeToColumn, columnToClockTime, dateRangesOverlap, isClockTime } from './schedule.time.js';

const ROOM_A = '0193c000-0000-7000-8000-0000000000a1';
const ROOM_B = '0193c000-0000-7000-8000-0000000000b2';
const TEACHER_1 = '0193c000-0000-7000-8000-0000000000c1';
const TEACHER_2 = '0193c000-0000-7000-8000-0000000000c2';

function slot(overrides: Partial<SlotValues> = {}): SlotValues {
  return { weekday: 0, startTime: '10:00', endTime: '11:00', roomId: ROOM_A, teacherUserId: TEACHER_1, effectiveFrom: '2026-01-01', effectiveTo: null, ...overrides };
}
const existing = (id: string, overrides: Partial<SlotValues> = {}): ExistingSlot => ({ id, ...slot(overrides) });
const keep = (row: ExistingSlot, overrides: Partial<SlotValues> = {}): RequestedSlot => ({ ...row, ...overrides });

const a = existing('a');
const b = existing('b', { weekday: 2 });
const c = existing('c', { weekday: 4, roomId: null, teacherUserId: null });

describe('schedule replacement planning (TEST-072)', () => {
  it('writes nothing for the stored schedule, in any order, and nothing for two empty lists', () => {
    expect(planScheduleReplacement([a, b, c], [keep(c), keep(a), keep(b)])).toMatchObject({ ok: true, changed: false, create: [], update: [], remove: [] });
    expect(planScheduleReplacement([], [])).toMatchObject({ ok: true, changed: false, counts: { added: 0, updated: 0, removed: 0 } });
  });

  it('creates slots without an id, deletes unlisted ones and updates only the changed fields of kept ones', () => {
    const plan = planScheduleReplacement([a, b, c], [keep(a, { endTime: '12:00', roomId: null }), slot({ weekday: 6, teacherUserId: null }), keep(c)]);
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.create).toEqual([slot({ weekday: 6, teacherUserId: null })]);
    expect(plan.update).toEqual([{ id: 'a', endTime: '12:00', roomId: null }]);
    expect(plan.remove).toEqual(['b']);
    expect(plan.counts).toEqual({ added: 1, updated: 1, removed: 1 });
    expect(plan.changed).toBe(true);
    expect(referencedIds(plan, 'roomId')).toEqual([ROOM_A]);
    expect(referencedIds(plan, 'teacherUserId')).toEqual([]);
  });

  it('refuses ids of other classes and repeated ids before planning anything', () => {
    expect(planScheduleReplacement([a, b], [keep(a), { ...slot(), id: 'zzz' }, keep(a)])).toEqual({ ok: false, unknown: ['zzz'], duplicates: ['a'] });
  });

  it('overlaps only on the same weekday with overlapping half-open times and overlapping inclusive effective ranges', () => {
    expect(slotsOverlap(slot(), slot({ startTime: '10:30', endTime: '11:30' }))).toBe(true);
    expect(slotsOverlap(slot(), slot({ startTime: '11:00', endTime: '12:00' }))).toBe(false); // adjacent
    expect(slotsOverlap(slot(), slot({ weekday: 1 }))).toBe(false);
    expect(slotsOverlap(slot({ effectiveTo: '2026-06-30' }), slot({ effectiveFrom: '2026-07-01' }))).toBe(false);
    expect(slotsOverlap(slot({ effectiveTo: '2026-06-30' }), slot({ effectiveFrom: '2026-06-30' }))).toBe(true); // a shared day
    expect(slotsOverlap(slot({ effectiveTo: '2026-06-30' }), slot({ effectiveFrom: '2025-01-01', effectiveTo: null }))).toBe(true);
  });

  it('names the first pair of the request that books the same room or teacher at overlapping times; slots without the resource never conflict on it', () => {
    expect(findRequestConflict([slot(), slot({ weekday: 1 })])).toBeNull();
    expect(findRequestConflict([slot(), slot({ startTime: '10:30', endTime: '11:30', teacherUserId: TEACHER_2 })])).toEqual({ kind: 'room', first: 0, second: 1 });
    expect(findRequestConflict([slot({ roomId: ROOM_B }), slot({ weekday: 1 }), slot({ startTime: '10:30', endTime: '11:30' })])).toEqual({ kind: 'teacher', first: 0, second: 2 });
    expect(findRequestConflict([slot({ roomId: null, teacherUserId: null }), slot({ roomId: null, teacherUserId: null })])).toBeNull();
    expect(findRequestConflict([slot(), slot({ startTime: '11:00', endTime: '12:00' })])).toBeNull();
  });

  it('flags the first slot outside the working days, and nothing when the days are not set', () => {
    expect(findNonWorkingDay([slot({ weekday: 0 }), slot({ weekday: 5 })], [0, 1, 2, 3, 4])).toEqual({ index: 1, weekday: 5 });
    expect(findNonWorkingDay([slot({ weekday: 5 })], null)).toBeNull();
    expect(findNonWorkingDay([slot({ weekday: 0 })], [0, 1, 2, 3, 4])).toBeNull();
  });

  it('time helpers: HH:MM validation, the 1970-01-01 time column round trip, range overlaps and today in a time zone', () => {
    expect(isClockTime('09:05')).toBe(true);
    expect(isClockTime('24:00')).toBe(false);
    expect(isClockTime('9:05')).toBe(false);
    expect(columnToClockTime(clockTimeToColumn('13:45'))).toBe('13:45');
    expect(clockRangesOverlap('10:00', '11:00', '11:00', '12:00')).toBe(false);
    expect(clockRangesOverlap('10:00', '11:00', '10:59', '12:00')).toBe(true);
    expect(dateRangesOverlap('2026-01-01', null, '2030-01-01', null)).toBe(true);
    expect(dateRangesOverlap('2026-01-01', '2026-01-31', '2026-02-01', null)).toBe(false);
    const noon = new Date('2026-11-06T22:30:00.000Z');
    expect(calendarDateIn('UTC', noon)).toBe('2026-11-06');
    expect(calendarDateIn('Asia/Riyadh', noon)).toBe('2026-11-07'); // UTC+3 is already past midnight
    expect(calendarDateIn('Mars/Olympus', noon)).toBe('2026-11-06'); // unknown zone → UTC
  });
});
