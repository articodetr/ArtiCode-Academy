// Fixtures for «my exams» (MOD-09-T04 — J-F50): the shapes of API-121 as the
// backend returns them (my-exams.dto.ts). The exam part reuses the J-F45
// fixture and the students those of J-F11, so the class, course, zone and
// people are the same everywhere.
import type { MyExamItem, MyExamList, MyExamResult } from '../api/myExams'
import { EXAM_LESSON, makeExam } from './exams'
import { SELF_STUDENT } from './myLessons'

/** The seeded student as far as «my exams» is concerned: ownership, no key (they also hold exams.read and exams.take). */
export const STUDENT_EXAM_PERMISSIONS = ['courses.read', 'schedule.read', 'lessons.read', 'assignments.read', 'assignments.submit', 'exams.read', 'exams.take', 'grades.read_own']

/** The seeded guardian: their children's exams by ownership. */
export const GUARDIAN_EXAM_PERMISSIONS = ['courses.read', 'schedule.read', 'attendance.read', 'assignments.read', 'exams.read', 'grades.read_linked']

/** The midterm of PY-101-A as its student sees it: scheduled on 2026-11-20 10:00 in Asia/Riyadh, 60 minutes, out of 50 (pass 25), no result yet. */
export function makeMyExam(overrides: Partial<MyExamItem> = {}): MyExamItem {
  const exam = makeExam({ status: 'scheduled' })
  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    type: exam.type,
    status: 'scheduled',
    scheduledAt: exam.scheduledAt,
    durationMinutes: exam.durationMinutes,
    timeZone: exam.timeZone,
    maxScore: exam.maxScore,
    passScore: exam.passScore,
    publishedAt: null,
    lesson: null,
    class: exam.class,
    relation: 'self',
    student: SELF_STUDENT,
    result: null,
    ...overrides,
  }
}

/** A scored result as API-121 shows it once the results are published: 41.5 with the teacher's feedback. */
export function makeMyExamResult(overrides: Partial<MyExamResult> = {}): MyExamResult {
  return { status: 'scored', score: 41.5, feedback: 'أحسنت في السؤال الثالث', ...overrides }
}

/** The same exam with its results published on 2026-11-22 and the student's scored result. */
export function makePublishedMyExam(overrides: Partial<MyExamItem> = {}): MyExamItem {
  return makeMyExam({ status: 'published', publishedAt: '2026-11-22T09:00:00.000Z', lesson: EXAM_LESSON, result: makeMyExamResult(), ...overrides })
}

export function makeMyExamList(items: MyExamItem[], nextCursor: string | null = null): MyExamList {
  return { items, nextCursor }
}
