// Fixtures for the «تقدّم التعلّم» tab of the class drawer (MOD-20): the shape of API-235 as the backend returns it.
import type { ClassLearningProgress, ClassLearningStudent } from '../api/learningProgress'
import type { ProgressCounts } from '../api/learning'
import { CLASS_COURSE_ID, CLASS_ID } from './classes'
import { ENROLLMENT_IDS, STUDENT_IDS, makeEnrollmentStudent } from './enrollments'

export function makeProgressCounts(overrides: Partial<ProgressCounts> = {}): ProgressCounts {
  return { total: 10, required: 8, completed: 4, completedRequired: 4, percent: 50, isComplete: false, completedAt: null, ...overrides }
}

export function makeLearningStudent(overrides: Partial<ClassLearningStudent> = {}): ClassLearningStudent {
  return {
    enrollmentId: ENROLLMENT_IDS[0],
    enrollmentStatus: 'active',
    student: makeEnrollmentStudent(),
    progress: makeProgressCounts(),
    lastActivityAt: '2026-11-18T09:30:00.000Z',
    lastLesson: { id: 'lesson-1', title: { ar: 'الشروط', en: 'Conditions' } },
    ...overrides,
  }
}

/** Three students: «عمر خالد» 50 %, «سارة» 100 % (completed), «يوسف» nothing yet. */
export function makeClassLearningProgress(overrides: Partial<ClassLearningProgress> = {}): ClassLearningProgress {
  return {
    classId: CLASS_ID,
    course: { id: CLASS_COURSE_ID, code: 'PY-101', name: { ar: 'أساسيات بايثون', en: 'Python Basics' } },
    totals: { lessons: 10, required: 8 },
    students: [
      makeLearningStudent(),
      makeLearningStudent({
        enrollmentId: ENROLLMENT_IDS[1],
        enrollmentStatus: 'completed',
        student: makeEnrollmentStudent({ id: STUDENT_IDS[1], fullName: 'سارة أحمد', displayName: 'سارة' }),
        progress: makeProgressCounts({ completed: 10, completedRequired: 8, percent: 100, isComplete: true, completedAt: '2026-11-17T12:00:00.000Z' }),
        lastActivityAt: '2026-11-17T12:00:00.000Z',
        lastLesson: { id: 'lesson-10', title: { ar: 'المشروع الختامي' } },
      }),
      makeLearningStudent({
        enrollmentId: ENROLLMENT_IDS[2],
        student: makeEnrollmentStudent({ id: STUDENT_IDS[2], fullName: 'يوسف علي', displayName: 'يوسف' }),
        progress: makeProgressCounts({ completed: 0, completedRequired: 0, percent: 0 }),
        lastActivityAt: null,
        lastLesson: null,
      }),
    ],
    ...overrides,
  }
}
