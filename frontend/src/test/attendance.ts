// Fixtures for the attendance sheet (MOD-06-T03 — J-F10): the shapes of API-099/API-100
// as the backend returns them, plus the permission sets of the seeded roles.
import type { AttendanceItem, AttendanceRecord, AttendanceSheet, AttendanceStudent } from '../api/attendance'
import { CLASS_ID, TEACHER_IDS } from './classes'
import { LESSON_ID } from './lessons'

export const STUDENT_IDS = [
  '0193e000-0000-7000-8000-00000000e001',
  '0193e000-0000-7000-8000-00000000e002',
  '0193e000-0000-7000-8000-00000000e003',
  '0193e000-0000-7000-8000-00000000e004',
] as const

/** Teachers by seed: the lessons of their classes, the sheet and the recording. */
export const ATTENDANCE_TEACHER_PERMISSIONS = ['lessons.read', 'lessons.manage', 'classes.read', 'courses.read', 'users.read', 'schedule.read', 'attendance.read', 'attendance.record']

/** Staff by seed: every lesson (classes.manage) and its sheet, read-only — no attendance.record. */
export const ATTENDANCE_STAFF_PERMISSIONS = ['lessons.read', 'classes.read', 'classes.manage', 'courses.read', 'users.read', 'schedule.read', 'attendance.read']

export function makeAttendanceStudent(overrides: Partial<AttendanceStudent> = {}): AttendanceStudent {
  return {
    id: STUDENT_IDS[0],
    fullName: 'سارة الطالبة',
    fullNameLatin: 'Sara',
    displayName: null,
    avatarUrl: null,
    status: 'active',
    email: null,
    username: null,
    phone: null,
    deletedAt: null,
    ...overrides,
  }
}

export function makeAttendanceRecord(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    status: 'present',
    minutesLate: null,
    note: null,
    recordedBy: { userId: TEACHER_IDS[0], fullName: 'خالد المعلم' },
    recordedAt: '2026-11-10T10:05:00.000Z',
    updatedAt: '2026-11-10T10:05:00.000Z',
    ...overrides,
  }
}

export function makeAttendanceItem(overrides: Partial<AttendanceItem> = {}): AttendanceItem {
  return { student: makeAttendanceStudent(), enrollmentStatus: 'active', record: null, ...overrides }
}

/**
 * The four students of PY-101-A for the lesson of makeLesson():
 * سارة (active, not recorded), يوسف (active, late 10 min with a note), ليلى (withdrawn after the lesson, present —
 * read-only) and عمر (completed, not recorded).
 */
export function fourStudents(): AttendanceItem[] {
  return [
    makeAttendanceItem(),
    makeAttendanceItem({
      student: makeAttendanceStudent({ id: STUDENT_IDS[1], fullName: 'يوسف الطالب', fullNameLatin: 'Yousef' }),
      record: makeAttendanceRecord({ status: 'late', minutesLate: 10, note: 'زحمة السير' }),
    }),
    makeAttendanceItem({
      student: makeAttendanceStudent({ id: STUDENT_IDS[2], fullName: 'ليلى المنسحبة', fullNameLatin: 'Layla' }),
      enrollmentStatus: 'withdrawn',
      record: makeAttendanceRecord(),
    }),
    makeAttendanceItem({ student: makeAttendanceStudent({ id: STUDENT_IDS[3], fullName: 'عمر الخريج', fullNameLatin: 'Omar' }), enrollmentStatus: 'completed' }),
  ]
}

export function makeAttendanceSheet(overrides: Partial<AttendanceSheet> = {}): AttendanceSheet {
  return {
    lessonId: LESSON_ID,
    classId: CLASS_ID,
    lessonStatus: 'scheduled',
    startsAt: '2026-11-10T10:00:00.000Z',
    endsAt: '2026-11-10T11:30:00.000Z',
    attendanceTakenAt: '2026-11-10T10:05:00.000Z',
    recordable: true,
    closedReason: null,
    counts: { recorded: 2, present: 1, absent: 0, late: 1, excused: 0 },
    items: fourStudents(),
    ...overrides,
  }
}
