// TEST-074 (unit) — lesson generation planning: dates, zone conversion across
// daylight-saving transitions (Intl only), and the plan itself.
import { describe, expect, it } from 'vitest';
import {
  GENERATION_MAX_DAYS,
  addDays,
  datesBetween,
  inclusiveDays,
  localDateOf,
  occurrenceKey,
  planGeneration,
  slotEffectiveOn,
  weekdayOf,
  zoneOffsetAt,
  zonedInstant,
} from './lesson-generation.plan.js';
import type { GenerationSlot } from './lesson-generation.plan.js';

const slot = (over: Partial<GenerationSlot> = {}): GenerationSlot => ({
  id: 'slot-a',
  weekday: 0,
  startTime: '10:00',
  endTime: '11:00',
  roomId: null,
  teacherUserId: null,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  timeZone: 'UTC',
  ...over,
});

describe('lesson generation plan (TEST-074)', () => {
  it('handles calendar dates: weekday, addDays, inclusiveDays, datesBetween', () => {
    expect(weekdayOf('2026-03-29')).toBe(0);
    expect(weekdayOf('2026-03-30')).toBe(1);
    expect(weekdayOf('2026-04-04')).toBe(6);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(inclusiveDays('2026-03-01', '2026-03-01')).toBe(1);
    expect(inclusiveDays('2026-03-01', '2026-03-07')).toBe(7);
    expect(inclusiveDays('2026-03-01', '2026-02-28')).toBe(0);
    expect(datesBetween('2026-03-28', '2026-03-30')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
    expect(datesBetween('2026-03-02', '2026-03-01')).toEqual([]);
    expect(GENERATION_MAX_DAYS).toBe(184);
  });

  it('converts wall-clock times in UTC and fixed-offset zones', () => {
    expect(zonedInstant('2026-03-29', '10:00', 'UTC').toISOString()).toBe('2026-03-29T10:00:00.000Z');
    expect(zonedInstant('2026-03-29', '10:00', 'Asia/Riyadh').toISOString()).toBe('2026-03-29T07:00:00.000Z');
    expect(zonedInstant('2026-03-29', '00:00', 'Asia/Riyadh').toISOString()).toBe('2026-03-28T21:00:00.000Z');
    expect(zoneOffsetAt('Asia/Riyadh', new Date('2026-03-29T07:00:00Z'))).toBe(3 * 3_600_000);
    expect(zoneOffsetAt('UTC', new Date('2026-03-29T07:00:00Z'))).toBe(0);
    expect(localDateOf(new Date('2026-03-28T21:00:00Z'), 'Asia/Riyadh')).toBe('2026-03-29');
    expect(localDateOf(new Date('2026-03-28T21:00:00Z'), 'UTC')).toBe('2026-03-28');
  });

  it('converts correctly on both sides of the daylight-saving transitions, through the gap and the overlap', () => {
    // Europe/Berlin: clocks move 02:00 → 03:00 on 2026-03-29 and 03:00 → 02:00 on 2026-10-25.
    expect(zonedInstant('2026-03-28', '10:00', 'Europe/Berlin').toISOString()).toBe('2026-03-28T09:00:00.000Z');
    expect(zonedInstant('2026-03-29', '10:00', 'Europe/Berlin').toISOString()).toBe('2026-03-29T08:00:00.000Z');
    expect(zonedInstant('2026-10-24', '10:00', 'Europe/Berlin').toISOString()).toBe('2026-10-24T08:00:00.000Z');
    expect(zonedInstant('2026-10-25', '10:00', 'Europe/Berlin').toISOString()).toBe('2026-10-25T09:00:00.000Z');
    // 02:30 does not exist on 2026-03-29: moved forward by the gap (03:30 CEST).
    expect(zonedInstant('2026-03-29', '02:30', 'Europe/Berlin').toISOString()).toBe('2026-03-29T01:30:00.000Z');
    // 02:30 exists twice on 2026-10-25: the later instant (standard time) wins.
    expect(zonedInstant('2026-10-25', '02:30', 'Europe/Berlin').toISOString()).toBe('2026-10-25T01:30:00.000Z');
    // America/New_York: 2026-03-08 and 2026-11-01.
    expect(zonedInstant('2026-03-07', '09:00', 'America/New_York').toISOString()).toBe('2026-03-07T14:00:00.000Z');
    expect(zonedInstant('2026-03-08', '09:00', 'America/New_York').toISOString()).toBe('2026-03-08T13:00:00.000Z');
    expect(zonedInstant('2026-10-31', '09:00', 'America/New_York').toISOString()).toBe('2026-10-31T13:00:00.000Z');
    expect(zonedInstant('2026-11-01', '09:00', 'America/New_York').toISOString()).toBe('2026-11-01T14:00:00.000Z');
    expect(localDateOf(new Date('2026-03-29T22:30:00Z'), 'Europe/Berlin')).toBe('2026-03-30');
  });

  it('plans one lesson per effective slot occurrence, skipping off days and existing occurrences, in time order', () => {
    const sunday = slot({ id: 'sun', weekday: 0, startTime: '10:00', endTime: '11:00', timeZone: 'Europe/Berlin', roomId: 'room-1', teacherUserId: 'teacher-1' });
    const tuesday = slot({ id: 'tue', weekday: 2, startTime: '09:00', endTime: '10:30', effectiveFrom: '2026-03-24', effectiveTo: '2026-03-31' });

    // Sundays 03-22, 03-29, 04-05 (existing); Tuesdays 03-24, 03-31 (04-07 is past effectiveTo).
    const plan = planGeneration([tuesday, sunday], '2026-03-22', '2026-04-07', null, new Set([occurrenceKey('sun', '2026-04-05')]));
    expect(plan).toMatchObject({ occurrences: 5, existing: 1, offDays: 0 });
    expect(plan.lessons.map((lesson) => [lesson.slotId, lesson.date, lesson.startsAt.toISOString(), lesson.endsAt.toISOString()])).toEqual([
      ['sun', '2026-03-22', '2026-03-22T09:00:00.000Z', '2026-03-22T10:00:00.000Z'],
      ['tue', '2026-03-24', '2026-03-24T09:00:00.000Z', '2026-03-24T10:30:00.000Z'],
      ['sun', '2026-03-29', '2026-03-29T08:00:00.000Z', '2026-03-29T09:00:00.000Z'],
      ['tue', '2026-03-31', '2026-03-31T09:00:00.000Z', '2026-03-31T10:30:00.000Z'],
    ]);
    expect(plan.lessons[0]).toMatchObject({ roomId: 'room-1', teacherUserId: 'teacher-1', timeZone: 'Europe/Berlin' });
    expect(plan.lessons[1]).toMatchObject({ roomId: null, teacherUserId: null, timeZone: 'UTC' });

    // Working days Monday–Friday: the three Sundays are off days.
    const weekdays = planGeneration([tuesday, sunday], '2026-03-22', '2026-04-07', [1, 2, 3, 4, 5], new Set());
    expect(weekdays).toMatchObject({ occurrences: 5, existing: 0, offDays: 3 });
    expect(weekdays.lessons.map((lesson) => lesson.date)).toEqual(['2026-03-24', '2026-03-31']);

    // No occurrence inside the range, and the effective range is inclusive on both ends.
    expect(planGeneration([sunday], '2026-03-23', '2026-03-28', null, new Set())).toEqual({ lessons: [], occurrences: 0, existing: 0, offDays: 0 });
    expect(slotEffectiveOn(tuesday, '2026-03-24')).toBe(true);
    expect(slotEffectiveOn(tuesday, '2026-03-31')).toBe(true);
    expect(slotEffectiveOn(tuesday, '2026-04-01')).toBe(false);
    expect(slotEffectiveOn(tuesday, '2026-03-23')).toBe(false);
  });
});
