// What a learner still lacks for the automatic course-completion certificate (J-F68), shown when they press
// «الشهادة» on a card of «دوراتي» before it is issued. The server issues it (CH-0363, CH-0244 —
// `AutoCertificatesService`) once BOTH hold:
//   1. every required published lesson of the course is complete — the server's own counts (`ProgressCounts`);
//   2. every scheduled or published exam of the class is PASSED: a result the learner may see (the server sends
//      `result` in «my exams» — API-121 — only once it is released) that is `excused`, or `scored` at or above the
//      exam's pass mark (any score when it has none).
// `examPassed()` is a manual mirror of `examPassed()` in backend/src/certificates/certificates.policy.ts — keep them in
// sync. Nothing here computes a grade: every number is the server's; this only sorts what the server sent.
import type { MyCertificateItem } from '../api/myCertificates'
import type { LearningWorkspace, ProgressCounts } from '../api/learning'
import type { MyExamItem, TakeBlocker } from '../api/myExams'
import type { LocalizedLabel } from '../api/users'
import type { Language } from '../i18n/language'
import { formatLessonDateTime } from '../lessons/lessons.format'
import type { Translate } from '../users/users.format'

/** Where one exam of the class stands for the certificate. */
export type ExamGapState =
  /** Passed — nothing to do. */
  | 'passed'
  /** Scored below the pass mark. */
  | 'failed'
  /** Recorded absent. */
  | 'absent'
  /** An online attempt is running: it counts once it is submitted. */
  | 'in_progress'
  /** Taken (or a manual exam), the result is not out yet. */
  | 'awaiting_result'
  /** Not taken yet. */
  | 'not_started'

export interface ExamGap {
  id: string
  title: LocalizedLabel
  state: ExamGapState
  /** The learner's score, when the server sent one. */
  score: number | null
  maxScore: number
  passScore: number | null
  /** An online exam the learner can start or resume now (the server's `canStart`). */
  canTake: boolean
  /** Why an online exam cannot be taken now (the server's `blocker`), else null. */
  blocker: TakeBlocker | null
  /** ISO 8601 — when an online exam opens (its `scheduledAt`); null when undated. */
  opensAt: string | null
  timeZone: string
}

/** One required lesson not completed yet. */
export interface LessonGap {
  id: string
  title: LocalizedLabel
  /** The level's number (1 = «المستوى الأول»); null for a lesson outside every level. */
  sectionNumber: number | null
  sectionTitle: LocalizedLabel | null
  /** `YYYY-MM-DD` of a level that is not open yet, else null. */
  opensOn: string | null
}

/** A mirror of `examPassed()` (certificates.policy.ts) on what «my exams» sends: `result` is there only once released. */
export function examPassed(item: Pick<MyExamItem, 'result' | 'passScore'>): boolean {
  const result = item.result
  if (result === null) return false
  if (result.status === 'excused') return true
  if (result.status !== 'scored' || result.score === null) return false
  return item.passScore === null || result.score >= item.passScore
}

export function examGapOf(item: MyExamItem): ExamGap {
  const online = item.online
  const base = {
    id: item.id,
    title: item.title,
    score: item.result?.status === 'scored' ? item.result.score : null,
    maxScore: item.maxScore,
    passScore: item.passScore,
    canTake: online?.canStart ?? false,
    blocker: online?.blocker ?? null,
    opensAt: online ? item.scheduledAt : null,
    timeZone: item.timeZone,
  }
  if (examPassed(item)) return { ...base, state: 'passed' }
  if (item.result?.status === 'absent') return { ...base, state: 'absent' }
  if (item.result !== null) return { ...base, state: 'failed' }
  if (online?.inProgress) return { ...base, state: 'in_progress' }
  // A manual exam is taken in class and recorded by the teacher; an online one the learner tried already.
  if (!online || online.attemptsUsed > 0) return { ...base, state: 'awaiting_result' }
  return { ...base, state: 'not_started' }
}

/** The required published lessons not completed yet, in curriculum order (API-230 — the learner's own course only). */
export function lessonGapsOf(workspace: LearningWorkspace): LessonGap[] {
  return workspace.sections.flatMap((section) =>
    section.items
      .filter((item) => item.isRequired && item.state !== 'completed')
      .map((item) => ({
        id: item.id,
        title: item.title,
        sectionNumber: section.id === null ? null : section.number,
        sectionTitle: section.title,
        opensOn: section.isOpen ? null : section.opensOn,
      })),
  )
}

export interface CertificateGaps {
  /** The server's lesson counts were read (API-229 or API-230); false when neither answered. */
  lessonsKnown: boolean
  /** Required lessons left, from the server's counts. */
  lessonsLeft: number
  lessonsRequired: number
  lessonsDone: number
  /** Every scheduled or published exam of the class for this student, in «my exams» order. */
  exams: ExamGap[]
  /** Both conditions hold — yet no certificate was found. */
  complete: boolean
}

export function certificateGaps(counts: ProgressCounts | null, exams: readonly MyExamItem[]): CertificateGaps {
  const gaps = exams.map(examGapOf)
  const lessonsRequired = counts?.required ?? 0
  const lessonsDone = counts?.completedRequired ?? 0
  const lessonsLeft = Math.max(lessonsRequired - lessonsDone, 0)
  // The server's `isComplete`: every required published lesson done — and a course with none never completes.
  const lessonsComplete = counts !== null && counts.isComplete
  return {
    lessonsKnown: counts !== null,
    lessonsLeft,
    lessonsRequired,
    lessonsDone,
    exams: gaps,
    complete: lessonsComplete && gaps.every((gap) => gap.state === 'passed'),
  }
}

/** The card's certificate: of the enrollment itself, else of the same student and course (one per course — CH-0363). */
export function certificateFor(
  items: readonly MyCertificateItem[],
  card: { enrollmentId: string; studentId: string; courseId: string },
): MyCertificateItem | null {
  const own = items.filter((item) => item.student.id === card.studentId && item.course.id === card.courseId)
  const pick = (list: MyCertificateItem[]) =>
    list.find((item) => item.status === 'issued' && item.enrollmentId === card.enrollmentId) ??
    list.find((item) => item.status === 'issued') ??
    list.find((item) => item.enrollmentId === card.enrollmentId) ??
    list[0] ??
    null
  return pick(own)
}

/** The exam's line: where it stands, with the server's numbers. */
export function examNote(exam: ExamGap, t: Translate, language: Language): string {
  const key = 'myClasses.certificateGaps.exams.state'
  switch (exam.state) {
    case 'passed':
      return t(`${key}.passed`)
    case 'failed': {
      const line = exam.passScore === null ? t(`${key}.failedNoMark`) : t(`${key}.failed`, { score: exam.score ?? 0, max: exam.maxScore, pass: exam.passScore })
      return exam.canTake ? `${line} ${t(`${key}.retry`)}` : line
    }
    case 'absent':
      return t(`${key}.absent`)
    case 'in_progress':
      return t(`${key}.inProgress`)
    case 'awaiting_result':
      return t(`${key}.awaitingResult`)
    case 'not_started':
      if (exam.blocker === 'not_open_yet' && exam.opensAt) return t(`${key}.opensAt`, { date: formatLessonDateTime(exam.opensAt, language, exam.timeZone) })
      if (exam.blocker === 'closed') return t(`${key}.closed`)
      if (exam.blocker === 'attempts_exhausted') return t(`${key}.exhausted`)
      return t(`${key}.notStarted`)
  }
}
