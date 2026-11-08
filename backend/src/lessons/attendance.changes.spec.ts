// TEST-078 (unit) — the pure attendance rules of MOD-06-T03.
import { describe, expect, it } from 'vitest';
import { attendanceBlocker, changedAttendanceFields, isEmptyAttendancePlan, isRecordableEnrollment, planAttendanceBatch } from './attendance.changes.js';
import type { AttendanceEntry, AttendanceValues } from './attendance.changes.js';

const NOW = new Date('2026-11-10T10:30:00Z');
const STARTED = new Date('2026-11-10T10:00:00Z');
const AT_NOW = new Date('2026-11-10T10:30:00Z');
const LATER = new Date('2026-11-10T10:30:01Z');

describe('attendanceBlocker', () => {
  it('is null for a non-cancelled lesson of a non-cancelled class once the start time has passed (the start instant included)', () => {
    expect(attendanceBlocker('open', 'scheduled', STARTED, NOW)).toBeNull();
    expect(attendanceBlocker('running', 'scheduled', AT_NOW, NOW)).toBeNull();
    expect(attendanceBlocker('completed', 'completed', STARTED, NOW)).toBeNull(); // corrections stay open for a completed class (D-R33 (1))
    expect(attendanceBlocker('planned', 'scheduled', STARTED, NOW)).toBeNull();
  });

  it('names the first blocker in order: the class, the lesson status, then the start time', () => {
    expect(attendanceBlocker('cancelled', 'scheduled', STARTED, NOW)).toBe('class_cancelled');
    expect(attendanceBlocker('cancelled', 'cancelled', LATER, NOW)).toBe('class_cancelled');
    expect(attendanceBlocker('open', 'cancelled', STARTED, NOW)).toBe('cancelled');
    expect(attendanceBlocker('open', 'cancelled', LATER, NOW)).toBe('cancelled');
    expect(attendanceBlocker('open', 'scheduled', LATER, NOW)).toBe('not_started');
  });
});

describe('isRecordableEnrollment', () => {
  it('accepts active and completed enrollments only', () => {
    expect(isRecordableEnrollment('active')).toBe(true);
    expect(isRecordableEnrollment('completed')).toBe(true);
    expect(isRecordableEnrollment('withdrawn')).toBe(false);
    expect(isRecordableEnrollment('cancelled')).toBe(false);
    expect(isRecordableEnrollment('pending')).toBe(false);
    expect(isRecordableEnrollment(null)).toBe(false);
    expect(isRecordableEnrollment(undefined)).toBe(false);
  });
});

describe('planAttendanceBatch', () => {
  const present: AttendanceValues = { status: 'present', minutesLate: null, note: null };
  const late: AttendanceValues = { status: 'late', minutesLate: 7, note: 'تأخر' };
  const existing = new Map<string, AttendanceValues>([
    ['s1', present],
    ['s2', late],
  ]);

  it('creates records for students without one, updates the ones that differ with their changed fields, and leaves identical ones alone — in request order', () => {
    const requests: AttendanceEntry[] = [
      { studentId: 's3', status: 'absent', minutesLate: null, note: null },
      { studentId: 's2', status: 'late', minutesLate: 7, note: 'تأخر' },
      { studentId: 's1', status: 'late', minutesLate: 3, note: null },
      { studentId: 's4', status: 'excused', minutesLate: null, note: 'عذر' },
    ];
    const plan = planAttendanceBatch(existing, requests);
    expect(plan.created).toEqual([requests[0], requests[3]]);
    expect(plan.updated).toEqual([{ studentId: 's1', data: { status: 'late', minutesLate: 3, note: null }, fields: ['status', 'minutesLate'] }]);
    expect(plan.unchanged).toEqual(['s2']);
    expect(isEmptyAttendancePlan(plan)).toBe(false);
  });

  it('an identical batch plans nothing, and a record is the whole new state: clearing the minutes and the note is an update', () => {
    const same = planAttendanceBatch(existing, [
      { studentId: 's1', status: 'present', minutesLate: null, note: null },
      { studentId: 's2', status: 'late', minutesLate: 7, note: 'تأخر' },
    ]);
    expect(same).toEqual({ created: [], updated: [], unchanged: ['s1', 's2'] });
    expect(isEmptyAttendancePlan(same)).toBe(true);
    const cleared = planAttendanceBatch(existing, [{ studentId: 's2', status: 'late', minutesLate: null, note: null }]);
    expect(cleared.updated).toEqual([{ studentId: 's2', data: { status: 'late', minutesLate: null, note: null }, fields: ['minutesLate', 'note'] }]);
    expect(changedAttendanceFields(late, { status: 'present', minutesLate: null, note: 'تأخر' })).toEqual(['status', 'minutesLate']);
  });

  it('does not touch the students absent from the request and copies the entries it creates', () => {
    const request: AttendanceEntry = { studentId: 's9', status: 'present', minutesLate: null, note: null };
    const plan = planAttendanceBatch(existing, [request]);
    expect(plan.created[0]).toEqual(request);
    expect(plan.created[0]).not.toBe(request);
    expect(plan.updated).toEqual([]);
    expect(plan.unchanged).toEqual([]);
  });
});
