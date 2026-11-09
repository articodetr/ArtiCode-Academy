// Fixtures for the assignments screen (MOD-08 — J-F38): the shapes of
// API-102..API-107 as the backend returns them, plus the permission sets of the
// seeded roles (backend/src/authorization/system-roles.ts).
import type { Assignment, AssignmentList, SubmissionCounts } from '../api/assignments'
import { CLASS_COURSE_ID, CLASS_ID } from './classes'
import { LESSON_ID } from './lessons'

export const ASSIGNMENT_ID = '0193e000-0000-7000-8000-00000000b001'
export const ASSIGNMENT_ID_2 = '0193e000-0000-7000-8000-00000000b002'

/**
 * The zone of the fixtures (as the academy fixture of test/academy.ts): neither
 * the CI runner's (UTC) nor the developers' machines' (Europe/Istanbul). Tests
 * about «same as this device» build their zone from deviceTimeZone() instead.
 */
export const ASSIGNMENT_TIME_ZONE = 'Asia/Riyadh'

/** An academy admin as far as the assignments screen is concerned: every class, every write, every picker. */
export const ASSIGNMENT_ADMIN_PERMISSIONS = ['assignments.read', 'assignments.manage', 'assignments.grade', 'classes.read', 'classes.manage', 'lessons.read', 'lessons.manage', 'courses.read', 'users.read']

/** Teachers by seed: the assignments of their assigned classes, and every write there (D-R16). */
export const ASSIGNMENT_TEACHER_PERMISSIONS = ['assignments.read', 'assignments.manage', 'assignments.grade', 'classes.read', 'lessons.read', 'lessons.manage', 'courses.read', 'users.read']

/** A custom role reading every class's assignments without writing (no seeded role holds this set; staff hold no assignments.* key). */
export const ASSIGNMENT_READER_PERMISSIONS = ['assignments.read', 'classes.read', 'classes.manage']

export const NO_SUBMISSIONS: SubmissionCounts = { students: 0, submitted: 0, graded: 0, returned: 0 }

/** A draft of PY-101-A without a lesson, due 2026-11-20 23:59 in Asia/Riyadh (20:59 UTC), out of 20 with a weight of 10. */
export function makeAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: ASSIGNMENT_ID,
    class: {
      id: CLASS_ID,
      code: 'PY-101-A',
      name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' },
      status: 'open',
      course: { id: CLASS_COURSE_ID, code: 'PY-101', name: { ar: 'أساسيات بايثون', en: 'Python Basics' } },
    },
    lesson: null,
    title: { ar: 'تمارين الحلقات', en: 'Loop exercises' },
    instructions: { ar: 'حلّ تمارين الصفحة 12' },
    maxScore: 20,
    weight: 10,
    status: 'draft',
    publishedAt: null,
    closedAt: null,
    dueAt: '2026-11-20T20:59:00.000Z',
    timeZone: ASSIGNMENT_TIME_ZONE,
    allowLate: false,
    latePenaltyPercent: null,
    maxAttempts: 1,
    submissions: { ...NO_SUBMISSIONS },
    activeStudents: 18,
    createdAt: '2026-11-09T08:00:00.000Z',
    updatedAt: '2026-11-09T08:00:00.000Z',
    ...overrides,
  }
}

/** The lesson of test/lessons.ts as an assignment links it (`AssignmentLessonDto`). */
export const LINKED_LESSON = { id: LESSON_ID, title: { ar: 'المتغيرات وأنواع البيانات', en: 'Variables and data types' }, startsAt: '2026-11-10T10:00:00.000Z' }

export function makeAssignmentList(items: Assignment[], nextCursor: string | null = null): AssignmentList {
  return { items, nextCursor }
}
