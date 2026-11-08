// Pure rules of MOD-06-T03 attendance (roadmap §4f.5 T03, owner decisions
// D-R32/D-R33), unit-tested in attendance.changes.spec.ts:
//
//   - When a lesson accepts attendance: its class is not cancelled (a completed
//     class keeps corrections open — D-R33 (1)), the lesson is not cancelled and
//     its start time has passed (D-R33 — the teacher records attendance from
//     the first minute, no «start» click). Anything else is a blocker.
//   - The batch is a diff: every record of the request is the WHOLE new state of
//     that student's record (status, minutesLate, note). A record is created
//     when the student has none, updated when any value differs, left alone when
//     identical; students absent from the request are never touched and nothing
//     is ever deleted (D-R33 (6)). The plan is computed before any write, so an
//     identical batch is a 200 without a write or an audit event.
import type { AttendanceStatus, ClassStatus, EnrollmentStatus, LessonStatus } from '../generated/prisma/client.js';
import type { AttendanceClosedReason } from './lessons.errors.js';
import { hasStarted } from './lessons.status.js';

/** A student may be recorded while their enrollment in the class is one of these (D-R33 (6)). */
export const ATTENDANCE_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = ['active', 'completed'];

/** Why a lesson refuses attendance right now: `class_cancelled` → `409 class_closed`, the others → `409 attendance_closed { reason }`. */
export type AttendanceBlocker = 'class_cancelled' | AttendanceClosedReason;

/** The values of one attendance record (the request's record is the whole new state). */
export interface AttendanceValues {
  status: AttendanceStatus;
  /** Whole minutes, only with status `late` (DTO rule; CHECKs in SQL are the backstop). */
  minutesLate: number | null;
  /** The teacher's note — shown on the sheet (API-099) only, never to students or guardians (D-R32). */
  note: string | null;
}

export interface AttendanceEntry extends AttendanceValues {
  studentId: string;
}

/** Catalogue order of the comparable fields (the `fields` of an update). */
export const ATTENDANCE_FIELDS = ['status', 'minutesLate', 'note'] as const;
export type AttendanceField = (typeof ATTENDANCE_FIELDS)[number];

export interface AttendanceUpdate {
  studentId: string;
  data: AttendanceValues;
  fields: AttendanceField[];
}

export interface AttendancePlan {
  /** Students without a record in the lesson: rows to insert, in request order. */
  created: AttendanceEntry[];
  /** Students whose record differs: the whole new state and the fields that change, in request order. */
  updated: AttendanceUpdate[];
  /** Students whose record already equals the request: nothing to write. */
  unchanged: string[];
}

/**
 * The reason attendance cannot be recorded for the lesson right now, or null
 * when it can. Checked in this order: the class, the lesson's status, its
 * start time.
 */
export function attendanceBlocker(classStatus: ClassStatus, lessonStatus: LessonStatus, startsAt: Date, now: Date = new Date()): AttendanceBlocker | null {
  if (classStatus === 'cancelled') return 'class_cancelled';
  if (lessonStatus === 'cancelled') return 'cancelled';
  if (!hasStarted(startsAt, now)) return 'not_started';
  return null;
}

/** True when a student with this enrollment status may be recorded (an absent enrollment never may). */
export function isRecordableEnrollment(status: EnrollmentStatus | null | undefined): boolean {
  return status !== null && status !== undefined && ATTENDANCE_ENROLLMENT_STATUSES.includes(status);
}

/** The fields of `next` whose value differs from `current`, in catalogue order. */
export function changedAttendanceFields(current: AttendanceValues, next: AttendanceValues): AttendanceField[] {
  return ATTENDANCE_FIELDS.filter((field) => current[field] !== next[field]);
}

/**
 * Splits the request into records to create, records to update (with the
 * fields that change) and records already equal to the request. `existing`
 * holds the lesson's current records by student id (only the requested
 * students need to be present). The caller has already checked that every
 * student is enrolled and that no student repeats.
 */
export function planAttendanceBatch(existing: ReadonlyMap<string, AttendanceValues>, requests: readonly AttendanceEntry[]): AttendancePlan {
  const plan: AttendancePlan = { created: [], updated: [], unchanged: [] };
  for (const request of requests) {
    const current = existing.get(request.studentId);
    if (!current) {
      plan.created.push({ ...request });
      continue;
    }
    const fields = changedAttendanceFields(current, request);
    if (fields.length === 0) plan.unchanged.push(request.studentId);
    else plan.updated.push({ studentId: request.studentId, data: { status: request.status, minutesLate: request.minutesLate, note: request.note }, fields });
  }
  return plan;
}

/** True when the plan writes nothing. */
export function isEmptyAttendancePlan(plan: AttendancePlan): boolean {
  return plan.created.length === 0 && plan.updated.length === 0;
}
