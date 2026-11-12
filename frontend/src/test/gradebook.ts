// Fixtures for the gradebook tab of the class drawer (J-F49 — MOD-09-T08 part c):
// the shape of API-126..API-128 as the backend returns it (assignments then
// exams that are not drafts; the active and completed enrollments in enrollment
// order; every cell aligned with the components), plus the permission sets of
// the seeded roles (backend/src/authorization/system-roles.ts). The numbers are
// what the server would send for these cells (D-R43: weights 20/30/50, the
// late penalty on the first assignment); the screen computes none of them.
import type { FinalGrade, Gradebook, GradebookCell, GradebookComponent, GradebookReadiness, GradebookStudent } from '../api/gradebook'
import { makeAttendanceStudent } from './attendance'
import { CLASS_ID, TEACHER_IDS } from './classes'
import { GRADE_SCHEME_IDS } from './gradeSchemes'

export const GRADEBOOK_ASSIGNMENT_IDS = ['01940000-0000-7000-8000-00000000a001', '01940000-0000-7000-8000-00000000a002', '01940000-0000-7000-8000-00000000a003'] as const
export const GRADEBOOK_EXAM_ID = '01940000-0000-7000-8000-00000000b001'
export const GRADEBOOK_STUDENT_IDS = [
  '01940000-0000-7000-8000-00000000c001',
  '01940000-0000-7000-8000-00000000c002',
  '01940000-0000-7000-8000-00000000c003',
  '01940000-0000-7000-8000-00000000c004',
] as const
export const GRADEBOOK_ENROLLMENT_IDS = [
  '01940000-0000-7000-8000-00000000d001',
  '01940000-0000-7000-8000-00000000d002',
  '01940000-0000-7000-8000-00000000d003',
  '01940000-0000-7000-8000-00000000d004',
] as const

/** Teachers by seed: the gradebook of the classes they teach, finalizing and withdrawing there (D-R16). */
export const GRADEBOOK_TEACHER_PERMISSIONS = ['classes.read', 'courses.read', 'users.read', 'enrollments.read', 'grades.read_all', 'grades.manage']

/** A custom role reading every class's gradebook without writing (no seeded role holds this set; staff hold no grades.* key). */
export const GRADEBOOK_READER_PERMISSIONS = ['classes.read', 'classes.manage', 'courses.read', 'grades.read_all']

export const DEFAULT_GRADEBOOK_SCHEME = { id: GRADE_SCHEME_IDS[0], name: { ar: 'السلّم الافتراضي', en: 'Default scale' } }

export function makeGradebookComponent(overrides: Partial<GradebookComponent> = {}): GradebookComponent {
  return {
    kind: 'assignment',
    id: GRADEBOOK_ASSIGNMENT_IDS[0],
    title: { ar: 'واجب الدوال', en: 'Functions homework' },
    weight: 20,
    maxScore: 20,
    latePenaltyPercent: 10,
    status: 'closed',
    counted: true,
    ...overrides,
  }
}

/** Functions homework (weight 20 of 20, 10% late penalty) · Mini project (30 of 50) · Practice (no weight, of 10) · Midterm exam (50 of 50). */
export function gradebookComponents(): GradebookComponent[] {
  return [
    makeGradebookComponent(),
    makeGradebookComponent({ id: GRADEBOOK_ASSIGNMENT_IDS[1], title: { ar: 'مشروع صغير', en: 'Mini project' }, weight: 30, maxScore: 50, latePenaltyPercent: null }),
    makeGradebookComponent({ id: GRADEBOOK_ASSIGNMENT_IDS[2], title: { ar: 'تمرين إضافي', en: 'Extra practice' }, weight: null, maxScore: 10, latePenaltyPercent: null, counted: false }),
    makeGradebookComponent({ kind: 'exam', id: GRADEBOOK_EXAM_ID, title: { ar: 'اختبار منتصف الفصل', en: 'Midterm exam' }, weight: 50, maxScore: 50, latePenaltyPercent: null, status: 'published' }),
  ]
}

const assignmentCell = (index: 0 | 1 | 2, overrides: Partial<GradebookCell>): GradebookCell => ({
  kind: 'assignment',
  id: GRADEBOOK_ASSIGNMENT_IDS[index],
  status: 'missing',
  score: null,
  effectiveScore: null,
  late: false,
  ...overrides,
})

const examCell = (overrides: Partial<GradebookCell>): GradebookCell => ({ kind: 'exam', id: GRADEBOOK_EXAM_ID, status: 'missing', score: null, effectiveScore: null, late: false, ...overrides })

export function makeFinalGrade(overrides: Partial<FinalGrade> = {}): FinalGrade {
  return {
    percent: 84.7,
    schemeId: GRADE_SCHEME_IDS[0],
    label: { ar: 'جيد جداً', en: 'Very good' },
    letter: 'B',
    isPass: true,
    finalizedAt: '2026-11-10T12:00:00.000Z',
    finalizedBy: { userId: TEACHER_IDS[0], fullName: 'خالد المعلم' },
    stale: false,
    ...overrides,
  }
}

/** Sara: the functions homework graded 18 but late (16.2 after the penalty), 45 on the project, 8 on the practice, 41.5 in the midterm; fixed at 84.7 (B). */
export function saraRow(overrides: Partial<GradebookStudent> = {}): GradebookStudent {
  return {
    enrollmentId: GRADEBOOK_ENROLLMENT_IDS[0],
    enrollmentStatus: 'active',
    student: makeAttendanceStudent({ id: GRADEBOOK_STUDENT_IDS[0], fullName: 'سارة الطالبة', fullNameLatin: 'Sara' }),
    cells: [
      assignmentCell(0, { status: 'graded', score: 18, effectiveScore: 16.2, late: true }),
      assignmentCell(1, { status: 'graded', score: 45, effectiveScore: 45 }),
      assignmentCell(2, { status: 'graded', score: 8, effectiveScore: 8 }),
      examCell({ status: 'scored', score: 41.5, effectiveScore: 41.5 }),
    ],
    current: 84.7,
    projected: 84.7,
    final: makeFinalGrade(),
    ...overrides,
  }
}

/** Yousef: a new attempt waits for review (an earlier one was graded 12), the project was sent back, nothing on the practice, absent from the midterm. */
export function yousefRow(overrides: Partial<GradebookStudent> = {}): GradebookStudent {
  return {
    enrollmentId: GRADEBOOK_ENROLLMENT_IDS[1],
    enrollmentStatus: 'active',
    student: makeAttendanceStudent({ id: GRADEBOOK_STUDENT_IDS[1], fullName: 'يوسف الطالب', fullNameLatin: 'Yousef', displayName: 'يوسف' }),
    cells: [
      assignmentCell(0, { status: 'awaiting_review', score: 12, effectiveScore: 12 }),
      assignmentCell(1, { status: 'returned' }),
      assignmentCell(2, { status: 'missing' }),
      examCell({ status: 'absent', effectiveScore: 0 }),
    ],
    current: 17.14,
    projected: 12,
    final: null,
    ...overrides,
  }
}

/** Layla: no homework, 40 on the project, the practice sent back, excused from the midterm; a final grade fixed before her project was graded (stale). */
export function laylaRow(overrides: Partial<GradebookStudent> = {}): GradebookStudent {
  return {
    enrollmentId: GRADEBOOK_ENROLLMENT_IDS[2],
    enrollmentStatus: 'active',
    student: makeAttendanceStudent({ id: GRADEBOOK_STUDENT_IDS[2], fullName: 'ليلى الطالبة', fullNameLatin: 'Layla' }),
    cells: [assignmentCell(0, { status: 'missing' }), assignmentCell(1, { status: 'graded', score: 40, effectiveScore: 40 }), assignmentCell(2, { status: 'returned' }), examCell({ status: 'excused' })],
    current: 80,
    projected: 48,
    final: makeFinalGrade({ percent: 52, label: { ar: 'ضعيف', en: 'Weak' }, letter: 'E', isPass: false, finalizedBy: null, stale: true }),
    ...overrides,
  }
}

/** Omar: a completed enrollment of a since-deleted account, full marks everywhere, no final grade yet. */
export function omarRow(overrides: Partial<GradebookStudent> = {}): GradebookStudent {
  return {
    enrollmentId: GRADEBOOK_ENROLLMENT_IDS[3],
    enrollmentStatus: 'completed',
    student: makeAttendanceStudent({ id: GRADEBOOK_STUDENT_IDS[3], fullName: 'عمر الخريج', fullNameLatin: 'Omar', deletedAt: '2026-11-11T08:00:00.000Z' }),
    cells: [
      assignmentCell(0, { status: 'graded', score: 20, effectiveScore: 20 }),
      assignmentCell(1, { status: 'graded', score: 50, effectiveScore: 50 }),
      assignmentCell(2, { status: 'graded', score: 10, effectiveScore: 10 }),
      examCell({ status: 'scored', score: 50, effectiveScore: 50 }),
    ],
    current: 100,
    projected: 100,
    final: null,
    ...overrides,
  }
}

/** Nothing blocks: three weighted components, none open, nothing waiting for review, the exam published. */
export const READY: GradebookReadiness = { openAssignments: 0, awaitingReview: 0, unpublishedExams: 0, weightedComponents: 3, ready: true }

/** The class's gradebook with every cell state, as the server sends it while the project is still open and Yousef's attempt waits for review. */
export function fullGradebook(overrides: Partial<Gradebook> = {}): Gradebook {
  const components = gradebookComponents()
  components[1] = { ...components[1]!, status: 'open' }
  return {
    class: { id: CLASS_ID, code: 'PY-101-A', name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' }, status: 'running' },
    components,
    students: [saraRow(), yousefRow(), laylaRow(), omarRow()],
    readiness: { openAssignments: 1, awaitingReview: 1, unpublishedExams: 0, weightedComponents: 3, ready: false },
    defaultScheme: { ...DEFAULT_GRADEBOOK_SCHEME },
    ...overrides,
  }
}

/** A running class whose grades are settled and not fixed yet: Sara and Omar, every weighted component closed or published. */
export function readyGradebook(overrides: Partial<Gradebook> = {}): Gradebook {
  return {
    class: { id: CLASS_ID, code: 'PY-101-A', name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' }, status: 'running' },
    components: gradebookComponents(),
    students: [saraRow({ final: null }), omarRow()],
    readiness: { ...READY },
    defaultScheme: { ...DEFAULT_GRADEBOOK_SCHEME },
    ...overrides,
  }
}

/** The answer of a finalization of readyGradebook(): both grades fixed with the scheme of `schemeId`. */
export function finalizedGradebook(schemeId: string = GRADE_SCHEME_IDS[0]): Gradebook {
  return readyGradebook({
    students: [
      saraRow({ final: makeFinalGrade({ schemeId, finalizedAt: '2026-11-12T10:00:00.000Z' }) }),
      omarRow({ final: makeFinalGrade({ schemeId, percent: 100, label: { ar: 'ممتاز', en: 'Excellent' }, letter: 'A', finalizedAt: '2026-11-12T10:00:00.000Z' }) }),
    ],
  })
}
