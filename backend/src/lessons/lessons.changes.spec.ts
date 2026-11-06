// TEST-077 (unit) — the pure lesson PATCH planner of MOD-06-T02.
import { describe, expect, it } from 'vitest';
import { isEmptyLessonPatch, mergedRange, planLessonUpdate } from './lessons.changes.js';
import type { LessonValues } from './lessons.changes.js';

const current: LessonValues = {
  title: { ar: 'الدرس الأول', en: 'Lesson 1' },
  description: { ar: 'وصف' },
  deliveryMode: 'in_person',
  startsAt: '2026-11-10T07:00:00.000Z',
  endsAt: '2026-11-10T08:30:00.000Z',
  roomId: 'room-1',
  teacherUserId: 'teacher-1',
  syllabusItemId: null,
  meetingUrl: null,
};

describe('isEmptyLessonPatch', () => {
  it('is true for an empty body and false once any field is present, null included', () => {
    expect(isEmptyLessonPatch({})).toBe(true);
    expect(isEmptyLessonPatch({ roomId: null })).toBe(false);
    expect(isEmptyLessonPatch({ title: { ar: 'x' } })).toBe(false);
  });
});

describe('planLessonUpdate', () => {
  it('writes only the fields whose value changes, in catalogue order, and nothing for an identical body', () => {
    const same = planLessonUpdate(current, {
      title: { en: 'Lesson 1', ar: 'الدرس الأول' },
      description: { ar: 'وصف' },
      deliveryMode: 'in_person',
      startsAt: '2026-11-10T07:00:00.000Z',
      roomId: 'room-1',
      syllabusItemId: null,
      meetingUrl: null,
    });
    expect(same).toEqual({ data: {}, fields: [] });

    const plan = planLessonUpdate(current, {
      meetingUrl: 'https://meet.example.com/x',
      roomId: null,
      title: { ar: 'الدرس الأول (معدَّل)' },
      endsAt: '2026-11-10T09:00:00.000Z',
      teacherUserId: 'teacher-1',
    });
    expect(plan.fields).toEqual(['title', 'endsAt', 'roomId', 'meetingUrl']);
    expect(plan.data).toEqual({ title: { ar: 'الدرس الأول (معدَّل)' }, endsAt: '2026-11-10T09:00:00.000Z', roomId: null, meetingUrl: 'https://meet.example.com/x' });
  });

  it('compares the description as a whole localized object, with null on either side', () => {
    expect(planLessonUpdate(current, { description: null }).fields).toEqual(['description']);
    expect(planLessonUpdate({ ...current, description: null }, { description: null }).fields).toEqual([]);
    expect(planLessonUpdate({ ...current, description: null }, { description: { ar: 'جديد' } }).fields).toEqual(['description']);
    expect(planLessonUpdate(current, { description: { ar: 'وصف', en: 'Desc' } }).fields).toEqual(['description']);
  });
});

describe('mergedRange', () => {
  it('takes the patched bound when given and the current one otherwise', () => {
    expect(mergedRange(current, {})).toEqual({ startsAt: current.startsAt, endsAt: current.endsAt });
    expect(mergedRange(current, { endsAt: '2026-11-10T10:00:00.000Z' })).toEqual({ startsAt: current.startsAt, endsAt: '2026-11-10T10:00:00.000Z' });
    expect(mergedRange(current, { startsAt: '2026-11-10T06:00:00.000Z', endsAt: '2026-11-10T06:30:00.000Z' })).toEqual({
      startsAt: '2026-11-10T06:00:00.000Z',
      endsAt: '2026-11-10T06:30:00.000Z',
    });
  });
});
