// Test fixtures of «My School» (MOD-20): the shapes of API-229 as the backend
// returns them (my-learning.dto.ts). Imported by tests only.
import type { MyLearningCourse, NextSession, ProgressCounts } from '../api/learning'

export const LEARNING_COURSE_IDS = ['0195a000-0000-7000-8000-00000000a001', '0195a000-0000-7000-8000-00000000a002', '0195a000-0000-7000-8000-00000000a003'] as const
export const LEARNING_ENROLLMENT_IDS = ['0195a000-0000-7000-8000-00000000b001', '0195a000-0000-7000-8000-00000000b002', '0195a000-0000-7000-8000-00000000b003'] as const
export const LEARNING_STUDENT = { id: '0195a000-0000-7000-8000-00000000c001', fullName: 'سارة أحمد', displayName: null }
/** PORTAL-04: a school subject (API-229 `course.subject`). */
export const LEARNING_SUBJECT = { id: '0195a000-0000-7000-8000-00000000a101', name: { ar: 'البرمجة', en: 'Programming' } }
export const LEARNING_CHILD = { id: '0195a000-0000-7000-8000-00000000c002', fullName: 'ليلى سعيد', displayName: null }

/** 3 of 8 required lessons done, nothing complete yet. */
export function makeProgress(overrides: Partial<ProgressCounts> = {}): ProgressCounts {
  return { total: 9, required: 8, completed: 3, completedRequired: 3, percent: 37, isComplete: false, completedAt: null, ...overrides }
}

/** The student's own active course «أساسيات بايثون», in progress, last opened lesson «المتغيرات». */
export function makeLearningCourse(overrides: Partial<MyLearningCourse> = {}): MyLearningCourse {
  return {
    enrollmentId: LEARNING_ENROLLMENT_IDS[0],
    relation: 'self',
    student: LEARNING_STUDENT,
    enrollment: { status: 'active', enrolledAt: '2026-11-01T09:00:00.000Z', activatedAt: '2026-11-01T09:00:00.000Z', completedAt: null },
    class: { id: '0195a000-0000-7000-8000-00000000d001', code: 'PY-101-A', name: { ar: 'بايثون — الفصل أ', en: 'Python — A' }, status: 'running', startsOn: '2026-11-01', endsOn: null },
    course: {
      id: LEARNING_COURSE_IDS[0],
      code: 'PY-101',
      name: { ar: 'أساسيات بايثون', en: 'Python basics' },
      summary: null,
      coverImageUrl: null,
      level: null,
      subject: null,
    },
    leadTeacher: { fullName: 'خالد المعلم', displayName: null },
    nextSession: null,
    progress: makeProgress(),
    lastLesson: { id: '0195a000-0000-7000-8000-00000000e001', title: { ar: 'المتغيرات', en: 'Variables' }, sectionNumber: 1, sectionTitle: null, openedAt: '2026-11-18T10:00:00.000Z' },
    lastActivityAt: '2026-11-18T10:00:00.000Z',
    action: 'continue',
    canLearn: true,
    ...overrides,
  }
}

/** The class's next session (D-R143): online, in UTC, far ahead, with a meeting link. */
export function makeNextSession(overrides: Partial<NextSession> = {}): NextSession {
  return {
    id: '0195a000-0000-7000-8000-00000000f001',
    title: { ar: 'حصة الحلقات', en: 'Loops session' },
    startsAt: '2030-01-20T10:00:00.000Z',
    endsAt: '2030-01-20T11:30:00.000Z',
    timeZone: 'UTC',
    deliveryMode: 'online',
    meetingUrl: 'https://meet.example.org/loops',
    syllabusItemId: null,
    ...overrides,
  }
}

/** A second own course «تطوير الويب», finished: every required lesson done and the enrollment completed. */
export function makeCompletedCourse(overrides: Partial<MyLearningCourse> = {}): MyLearningCourse {
  return makeLearningCourse({
    enrollmentId: LEARNING_ENROLLMENT_IDS[1],
    enrollment: { status: 'completed', enrolledAt: '2026-09-01T09:00:00.000Z', activatedAt: '2026-09-01T09:00:00.000Z', completedAt: '2026-10-30T09:00:00.000Z' },
    class: { id: '0195a000-0000-7000-8000-00000000d002', code: 'WEB-201-A', name: { ar: 'تطوير الويب — أ', en: 'Web — A' }, status: 'completed', startsOn: '2026-09-01', endsOn: '2026-10-30' },
    course: { id: LEARNING_COURSE_IDS[1], code: 'WEB-201', name: { ar: 'تطوير الويب', en: 'Web development' }, summary: null, coverImageUrl: null, level: null, subject: null },
    progress: makeProgress({ completed: 6, completedRequired: 6, required: 6, total: 6, percent: 100, isComplete: true, completedAt: '2026-10-29T09:00:00.000Z' }),
    lastLesson: null,
    lastActivityAt: '2026-10-29T09:00:00.000Z',
    action: 'review',
    ...overrides,
  })
}

/** A guardian's view of their child's course: read-only, no action. */
export function makeChildCourse(overrides: Partial<MyLearningCourse> = {}): MyLearningCourse {
  return makeLearningCourse({
    enrollmentId: LEARNING_ENROLLMENT_IDS[2],
    relation: 'child',
    student: LEARNING_CHILD,
    course: { id: LEARNING_COURSE_IDS[2], code: 'AR-110', name: { ar: 'اللغة العربية', en: 'Arabic' }, summary: null, coverImageUrl: null, level: null, subject: null },
    progress: makeProgress({ required: 2, completedRequired: 1, completed: 1, total: 2, percent: 50 }),
    action: null,
    canLearn: false,
    ...overrides,
  })
}
