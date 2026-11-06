// TEST-077 (unit) — the lesson state machine and edit locks of MOD-06-T02.
import { describe, expect, it } from 'vitest';
import { allowedLessonActions, hasStarted, isLessonDeletable, lockedFields, nextLessonStatus } from './lessons.status.js';

describe('nextLessonStatus / allowedLessonActions', () => {
  it('allows complete and cancel from scheduled, restore from cancelled, nothing from completed', () => {
    expect(nextLessonStatus('complete', 'scheduled')).toBe('completed');
    expect(nextLessonStatus('cancel', 'scheduled')).toBe('cancelled');
    expect(nextLessonStatus('restore', 'cancelled')).toBe('scheduled');
    expect(nextLessonStatus('restore', 'scheduled')).toBeNull();
    expect(nextLessonStatus('cancel', 'completed')).toBeNull();
    expect(nextLessonStatus('complete', 'cancelled')).toBeNull();
    expect(nextLessonStatus('complete', 'in_progress')).toBeNull();
    expect(allowedLessonActions('scheduled')).toEqual(['complete', 'cancel']);
    expect(allowedLessonActions('cancelled')).toEqual(['restore']);
    expect(allowedLessonActions('completed')).toEqual([]);
    expect(allowedLessonActions('in_progress')).toEqual([]);
  });
});

describe('hasStarted / isLessonDeletable', () => {
  it('completes a lesson only once its start time has passed, and deletes a scheduled lesson without attendance only', () => {
    const now = new Date('2026-11-10T10:00:00Z');
    expect(hasStarted(new Date('2026-11-10T10:00:00Z'), now)).toBe(true);
    expect(hasStarted(new Date('2026-11-10T09:59:59Z'), now)).toBe(true);
    expect(hasStarted(new Date('2026-11-10T10:00:01Z'), now)).toBe(false);
    expect(isLessonDeletable('scheduled', 0)).toBe(true);
    expect(isLessonDeletable('scheduled', 1)).toBe(false);
    expect(isLessonDeletable('completed', 0)).toBe(false);
    expect(isLessonDeletable('cancelled', 0)).toBe(false);
  });
});

describe('lockedFields', () => {
  it('locks nothing for a scheduled lesson, the timing fields for a completed one and everything for a cancelled one', () => {
    const requested = ['title', 'startsAt', 'endsAt', 'roomId', 'teacherUserId', 'meetingUrl'];
    expect(lockedFields('scheduled', requested)).toEqual([]);
    expect(lockedFields('completed', requested)).toEqual(['startsAt', 'endsAt', 'roomId', 'teacherUserId']);
    expect(lockedFields('in_progress', ['title', 'roomId'])).toEqual(['roomId']);
    expect(lockedFields('cancelled', ['title'])).toEqual(['title']);
    expect(lockedFields('completed', ['title', 'description', 'syllabusItemId'])).toEqual([]);
  });
});
