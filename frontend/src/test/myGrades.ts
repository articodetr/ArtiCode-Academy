// Fixtures for «my grades» (MOD-09-T06 — J-F50): the shapes of API-129 as the
// backend returns them (my-grades.dto.ts), plus the permission sets of the
// seeded learner roles (backend/src/authorization/system-roles.ts). The class
// is the PY-101-A of the other fixtures and the students those of J-F11.
import type { MyFinalGrade, MyGradeComponent, MyGradeItem, MyGradeList } from '../api/myGrades'
import { ASSIGNMENT_ID, ASSIGNMENT_ID_2 } from './assignments'
import { ENROLLMENT_IDS } from './enrollments'
import { EXAM_ID, EXAM_ID_2, makeExam } from './exams'
import { SELF_STUDENT } from './myLessons'

/** The seeded student: their own grades (`grades.read_own`). */
export const STUDENT_GRADES_PERMISSIONS = ['courses.read', 'schedule.read', 'lessons.read', 'assignments.read', 'assignments.submit', 'exams.read', 'exams.take', 'grades.read_own']

/** The seeded guardian: their children's grades (`grades.read_linked`). */
export const GUARDIAN_GRADES_PERMISSIONS = ['courses.read', 'schedule.read', 'attendance.read', 'assignments.read', 'exams.read', 'grades.read_linked']

export const EXAM_ID_3 = '0193f000-0000-7000-8000-00000000d003'
export const ASSIGNMENT_ID_3 = '0193e000-0000-7000-8000-00000000b003'

/** A graded assignment: 18 out of 20 with a weight of 10, on time. */
export function makeGradeComponent(overrides: Partial<MyGradeComponent> = {}): MyGradeComponent {
  return {
    kind: 'assignment',
    id: ASSIGNMENT_ID,
    title: { ar: 'تمارين الحلقات', en: 'Loop exercises' },
    weight: 10,
    maxScore: 20,
    status: 'graded',
    score: 18,
    effectiveScore: 18,
    late: false,
    ...overrides,
  }
}

/**
 * The six components of the fixture enrollment, in the server's order (assignments, then published exams):
 * a late graded assignment with its penalty applied by the server (18 → 16.2), an attempt waiting for review,
 * an informational assignment never submitted, a scored midterm (41.5 / 50), an absence (counts 0) and an excused oral.
 */
export function sixComponents(): MyGradeComponent[] {
  return [
    makeGradeComponent({ late: true, effectiveScore: 16.2 }),
    makeGradeComponent({ id: ASSIGNMENT_ID_2, title: { ar: 'واجب الدوال' }, status: 'awaiting_review', score: null, effectiveScore: null }),
    makeGradeComponent({ id: ASSIGNMENT_ID_3, title: { ar: 'قراءة إضافية' }, weight: null, maxScore: 10, status: 'missing', score: null, effectiveScore: null }),
    makeGradeComponent({ kind: 'exam', id: EXAM_ID, title: makeExam().title, weight: 30, maxScore: 50, status: 'scored', score: 41.5, effectiveScore: 41.5 }),
    makeGradeComponent({ kind: 'exam', id: EXAM_ID_2, title: { ar: 'اختبار قصير' }, weight: 20, maxScore: 10, status: 'absent', score: null, effectiveScore: 0 }),
    makeGradeComponent({ kind: 'exam', id: EXAM_ID_3, title: { ar: 'اختبار شفهي' }, weight: 10, maxScore: 5, status: 'excused', score: null, effectiveScore: null }),
  ]
}

/** The final grade as the server fixed it: 86.4 % in the band «جيد جداً» (B), a pass. */
export function makeFinalGrade(overrides: Partial<MyFinalGrade> = {}): MyFinalGrade {
  return { percent: 86.4, label: { ar: 'جيد جداً', en: 'Very good' }, letter: 'B', isPass: true, finalizedAt: '2026-12-21T10:00:00.000Z', ...overrides }
}

/** The student's own active enrollment in PY-101-A with the six components, not finalized yet. */
export function makeMyGradeItem(overrides: Partial<MyGradeItem> = {}): MyGradeItem {
  return {
    enrollmentId: ENROLLMENT_IDS[0],
    enrollmentStatus: 'active',
    relation: 'self',
    student: SELF_STUDENT,
    class: makeExam().class,
    components: sixComponents(),
    final: null,
    ...overrides,
  }
}

export function makeMyGradeList(items: MyGradeItem[]): MyGradeList {
  return { items }
}
