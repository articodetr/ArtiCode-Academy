// Attendance of a lesson (MOD-06-T03 — J-F10): API-099 GET and API-100 PUT
// /api/lessons/:id/attendance. Types mirror backend/src/lessons/attendance.dto.ts;
// every call goes through apiRequest (Bearer header, refresh-and-retry on 401).
// Reading needs `attendance.read`, writing `attendance.record`, both through
// the lesson's class visibility (D-R16/D-R32: an assigned teacher, or a holder
// of `classes.manage`; anyone else gets 404) — the server decides. Every record
// of a PUT is the WHOLE new state of that student's record (an absent
// `minutesLate` or `note` clears it); students absent from the batch are never
// touched and nothing is deleted. Instants are ISO 8601 in UTC.
import { apiRequest } from './client'
import { LESSONS_PATH } from './lessons'
import type { AttendanceCounts, LessonStatus } from './lessons'
import type { UserStatus } from './users'

/** In the order of the Prisma enum `attendance_status`. */
export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

/** In the order of the Prisma enum `enrollment_status`. */
export const SHEET_ENROLLMENT_STATUSES = ['pending', 'active', 'completed', 'withdrawn', 'cancelled'] as const
export type SheetEnrollmentStatus = (typeof SHEET_ENROLLMENT_STATUSES)[number]

/** A student may be recorded while their enrollment is one of these (`ATTENDANCE_ENROLLMENT_STATUSES` — D-R33 (6)); anyone else is `not_enrolled`. */
export const RECORDABLE_ENROLLMENT_STATUSES: readonly SheetEnrollmentStatus[] = ['active', 'completed']

/** Why a PUT is refused right now: `class_cancelled` (→ `409 class_closed`), `cancelled` or `not_started` (→ `409 attendance_closed`). */
export const ATTENDANCE_BLOCKERS = ['class_cancelled', 'cancelled', 'not_started'] as const
export type AttendanceBlocker = (typeof ATTENDANCE_BLOCKERS)[number]

/** Mirrors of the DTO limits (backend/src/lessons/attendance.dto.ts). */
export const ATTENDANCE_BATCH_MAX = 500
export const ATTENDANCE_NOTE_MAX_LENGTH = 500
/** Whole minutes of lateness, with status `late` only: at most the longest lesson (12 h). */
export const MINUTES_LATE_MAX = 720

/** `EnrollmentStudentDto` in the caller's projection: `email`/`username`/`phone` are null without `users.read_contact` (D-R07). */
export interface AttendanceStudent {
  id: string
  fullName: string
  fullNameLatin: string | null
  displayName: string | null
  avatarUrl: string | null
  status: UserStatus
  email: string | null
  username: string | null
  phone: string | null
  /** Set when the account was soft-deleted after enrolling (the enrollment and the record stay). */
  deletedAt: string | null
}

/** `ScheduleTeacherDto`: who last wrote the record (null when that account was deleted). */
export interface AttendanceRecorder {
  userId: string
  fullName: string
}

/** `AttendanceRecordDto`. */
export interface AttendanceRecord {
  status: AttendanceStatus
  /** With status `late` only. */
  minutesLate: number | null
  /** The teacher's note — on the sheet only, never shown to the student or the guardian (D-R32). */
  note: string | null
  recordedBy: AttendanceRecorder | null
  /** When the record was first written. */
  recordedAt: string
  updatedAt: string
}

/** `AttendanceItemDto`: one student of the sheet with their record or null. */
export interface AttendanceItem {
  student: AttendanceStudent
  /** `withdrawn`/`cancelled` students stay listed while they hold a record but can no longer be recorded. */
  enrollmentStatus: SheetEnrollmentStatus | null
  record: AttendanceRecord | null
}

/** `AttendanceSheetDto` (API-099), also the answer of every successful PUT (API-100). */
export interface AttendanceSheet {
  lessonId: string
  classId: string
  lessonStatus: LessonStatus
  startsAt: string
  endsAt: string
  /** Set by the first recording, never changed afterwards. */
  attendanceTakenAt: string | null
  /** True when a PUT would be accepted right now (D-R33). */
  recordable: boolean
  closedReason: AttendanceBlocker | null
  counts: AttendanceCounts
  /** Every student with an active or completed enrollment, plus anyone holding a record in the lesson; in enrollment order. */
  items: AttendanceItem[]
}

/** One record of a PUT — the whole new state of that student's record. */
export interface AttendanceRecordInput {
  studentId: string
  status: AttendanceStatus
  /** A whole number 1–720, with status `late` only; absent = none. */
  minutesLate?: number
  /** Up to 500 characters; absent = none. */
  note?: string
}

/** `RecordAttendanceDto` (API-100): 1–500 records, no student twice. */
export interface RecordAttendanceInput {
  records: AttendanceRecordInput[]
}

export function attendancePath(lessonId: string): string {
  return `${LESSONS_PATH}/${encodeURIComponent(lessonId)}/attendance`
}

/** API-099 — the attendance sheet of a lesson. */
export function getAttendanceSheet(lessonId: string, signal?: AbortSignal): Promise<AttendanceSheet> {
  return apiRequest<AttendanceSheet>(attendancePath(lessonId), { signal })
}

/** API-100 — records or corrects a batch; answers with the sheet after the write (an identical batch writes nothing). */
export function recordAttendance(lessonId: string, input: RecordAttendanceInput): Promise<AttendanceSheet> {
  return apiRequest<AttendanceSheet>(attendancePath(lessonId), { method: 'PUT', body: input })
}
