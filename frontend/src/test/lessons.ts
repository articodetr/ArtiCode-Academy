// Fixtures for the lessons screen (MOD-06 — J-F09): the shapes of API-093..API-098
// as the backend returns them, plus the permission sets of the seeded roles.
import type { AttendanceCounts, Lesson, LessonList } from '../api/lessons'
import { CLASS_COURSE_ID, CLASS_ID, TEACHER_IDS } from './classes'
import { SYLLABUS_ITEM_IDS } from './courses'
import { ROOM_ID } from './timetable'

export const LESSON_ID = '0193d000-0000-7000-8000-00000000a001'
export const LESSON_ID_2 = '0193d000-0000-7000-8000-00000000a002'

/** An academy admin as far as the lessons screen is concerned: every class, every write, every picker. */
export const LESSON_ADMIN_PERMISSIONS = ['lessons.read', 'lessons.manage', 'classes.read', 'classes.manage', 'courses.read', 'users.read', 'schedule.read']

/** Staff by seed: every lesson (classes.manage) read-only — no lessons.manage. */
export const LESSON_STAFF_PERMISSIONS = ['lessons.read', 'classes.read', 'classes.manage', 'courses.read', 'users.read', 'schedule.read']

/** Teachers by seed: the lessons of their assigned classes, and every write there (D-R16). */
export const LESSON_TEACHER_PERMISSIONS = ['lessons.read', 'lessons.manage', 'classes.read', 'courses.read', 'users.read', 'schedule.read']

/** Students by seed: lessons.read without any class assignment — the list is empty until «my lessons» (API-101). */
export const LESSON_LEARNER_PERMISSIONS = ['lessons.read', 'courses.read', 'schedule.read']

export const EMPTY_ATTENDANCE: AttendanceCounts = { recorded: 0, present: 0, absent: 0, late: 0, excused: 0 }

/** A scheduled in-person lesson of PY-101-A on 2026-11-10 10:00–11:30 UTC in LAB-1 with the lead teacher and the first syllabus item. */
export function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: LESSON_ID,
    class: {
      id: CLASS_ID,
      code: 'PY-101-A',
      name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' },
      status: 'open',
      course: { id: CLASS_COURSE_ID, code: 'PY-101', name: { ar: 'أساسيات بايثون', en: 'Python Basics' } },
    },
    title: { ar: 'المتغيرات وأنواع البيانات', en: 'Variables and data types' },
    description: null,
    deliveryMode: 'in_person',
    startsAt: '2026-11-10T10:00:00.000Z',
    endsAt: '2026-11-10T11:30:00.000Z',
    status: 'scheduled',
    room: { id: ROOM_ID, code: 'LAB-1', name: { ar: 'مختبر 1', en: 'Lab 1' }, branch: null },
    teacher: { userId: TEACHER_IDS[0], fullName: 'خالد المعلم' },
    syllabusItem: { id: SYLLABUS_ITEM_IDS[0], sortOrder: 0, title: { ar: 'المتغيرات', en: 'Variables' } },
    scheduleId: null,
    meetingUrl: null,
    cancellationReason: null,
    attendanceTakenAt: null,
    attendance: { ...EMPTY_ATTENDANCE },
    createdAt: '2026-11-06T08:00:00.000Z',
    updatedAt: '2026-11-06T08:00:00.000Z',
    ...overrides,
  }
}

export function makeLessonList(items: Lesson[], nextCursor: string | null = null): LessonList {
  return { items, nextCursor }
}
