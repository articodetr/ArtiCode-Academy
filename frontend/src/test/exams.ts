// Fixtures for the exams screens (MOD-09 — J-F45): the shapes of API-113..API-120
// as the backend returns them, plus the permission sets of the seeded roles
// (backend/src/authorization/system-roles.ts).
import type { ExamResult, ExamResultItem, ExamResultsSheet } from '../api/examResults'
import type { Exam, ExamList, ExamResultCounts } from '../api/exams'
import { makeAttendanceStudent } from './attendance'
import { CLASS_COURSE_ID, CLASS_ID, TEACHER_IDS } from './classes'
import { LESSON_ID } from './lessons'

export const EXAM_ID = '0193f000-0000-7000-8000-00000000d001'
export const EXAM_ID_2 = '0193f000-0000-7000-8000-00000000d002'

/**
 * The zone of the fixtures (as the academy fixture of test/academy.ts): neither
 * the CI runner's (UTC) nor the developers' machines' (Europe/Istanbul). Tests
 * about «same as this device» build their zone from deviceTimeZone() instead.
 */
export const EXAM_TIME_ZONE = 'Asia/Riyadh'

/** An academy admin as far as the exams screens are concerned: every class, every write, the sheet and every picker. */
export const EXAM_ADMIN_PERMISSIONS = ['exams.read', 'exams.manage', 'exams.grade', 'classes.read', 'classes.manage', 'lessons.read', 'lessons.manage', 'courses.read', 'users.read']

/** Teachers by seed: the exams of their assigned classes, every write there and the results sheet (D-R16). */
export const EXAM_TEACHER_PERMISSIONS = ['exams.read', 'exams.manage', 'exams.grade', 'classes.read', 'lessons.read', 'lessons.manage', 'courses.read', 'users.read']

/** A custom role reading every class's exams and their sheets without writing (no seeded role holds this set; staff hold no exams.* key). */
export const EXAM_READER_PERMISSIONS = ['exams.read', 'classes.read', 'classes.manage']

export const NO_RESULTS: ExamResultCounts = { students: 0, scored: 0, absent: 0, excused: 0 }

/** A draft midterm of PY-101-A without a lesson on 2026-11-20 10:00 in Asia/Riyadh (07:00 UTC), 60 minutes, out of 50 (pass 25) with a weight of 30. */
export function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: EXAM_ID,
    class: {
      id: CLASS_ID,
      code: 'PY-101-A',
      name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' },
      status: 'open',
      course: { id: CLASS_COURSE_ID, code: 'PY-101', name: { ar: 'أساسيات بايثون', en: 'Python Basics' } },
    },
    lesson: null,
    title: { ar: 'اختبار منتصف الفصل', en: 'Midterm exam' },
    description: { ar: 'الفصول 1 إلى 4' },
    type: 'midterm',
    status: 'draft',
    scheduledAt: '2026-11-20T07:00:00.000Z',
    durationMinutes: 60,
    timeZone: EXAM_TIME_ZONE,
    maxScore: 50,
    passScore: 25,
    weight: 30,
    publishedAt: null,
    results: { ...NO_RESULTS },
    activeStudents: 18,
    createdAt: '2026-11-09T08:00:00.000Z',
    updatedAt: '2026-11-09T08:00:00.000Z',
    ...overrides,
  }
}

/** The lesson of test/lessons.ts as an exam links it (`AssignmentLessonDto`). */
export const EXAM_LESSON = { id: LESSON_ID, title: { ar: 'المتغيرات وأنواع البيانات', en: 'Variables and data types' }, startsAt: '2026-11-10T10:00:00.000Z' }

export function makeExamList(items: Exam[], nextCursor: string | null = null): ExamList {
  return { items, nextCursor }
}

export const RESULT_STUDENT_IDS = [
  '0193f000-0000-7000-8000-00000000e001',
  '0193f000-0000-7000-8000-00000000e002',
  '0193f000-0000-7000-8000-00000000e003',
  '0193f000-0000-7000-8000-00000000e004',
] as const

export function makeExamResult(overrides: Partial<ExamResult> = {}): ExamResult {
  return {
    status: 'scored',
    score: 41.5,
    feedback: null,
    recordedBy: { userId: TEACHER_IDS[0], fullName: 'خالد المعلم' },
    recordedAt: '2026-11-20T09:00:00.000Z',
    updatedAt: '2026-11-20T09:00:00.000Z',
    ...overrides,
  }
}

export function makeResultItem(overrides: Partial<ExamResultItem> = {}): ExamResultItem {
  return { student: makeAttendanceStudent({ id: RESULT_STUDENT_IDS[0] }), enrollmentStatus: 'active', result: null, ...overrides }
}

/**
 * The four students of PY-101-A for the exam of makeExam(): سارة (active, no result), يوسف (active, scored 41.5 with
 * feedback), ليلى (withdrawn after the exam, absent — read-only) and عمر (completed, no result).
 */
export function fourResultStudents(): ExamResultItem[] {
  return [
    makeResultItem(),
    makeResultItem({
      student: makeAttendanceStudent({ id: RESULT_STUDENT_IDS[1], fullName: 'يوسف الطالب', fullNameLatin: 'Yousef' }),
      result: makeExamResult({ feedback: 'أحسنت في السؤال الثالث' }),
    }),
    makeResultItem({
      student: makeAttendanceStudent({ id: RESULT_STUDENT_IDS[2], fullName: 'ليلى المنسحبة', fullNameLatin: 'Layla' }),
      enrollmentStatus: 'withdrawn',
      result: makeExamResult({ status: 'absent', score: null }),
    }),
    makeResultItem({ student: makeAttendanceStudent({ id: RESULT_STUDENT_IDS[3], fullName: 'عمر الخريج', fullNameLatin: 'Omar' }), enrollmentStatus: 'completed' }),
  ]
}

export function makeResultsSheet(overrides: Partial<ExamResultsSheet> = {}): ExamResultsSheet {
  return {
    examId: EXAM_ID,
    classId: CLASS_ID,
    examStatus: 'scheduled',
    maxScore: 50,
    recordable: true,
    closedReason: null,
    counts: { students: 2, scored: 1, absent: 1, excused: 0 },
    items: fourResultStudents(),
    ...overrides,
  }
}
