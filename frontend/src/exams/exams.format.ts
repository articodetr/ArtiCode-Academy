// Pure labels of the exam screens (J-F45): the title in the active language,
// the «recorded / total» ratio of the results and the colours of the result
// statuses — every number is the server's (no grade is computed here). Instants
// are formatted with the assignments' zoned formatters (assignments.format.ts)
// in the exam's `timeZone` (D-R41). No React, no i18next instance.
//
// MOD-09 phase 2: the words of what keeps an online draft from being made
// available (`exam.online.problems`, and the `exam_not_ready` refusal of
// `schedule`) and where each one is put right — the «الأسئلة» tab or the edit
// form. The list itself is the server's, at its clock.
import type { ExamResultStatus } from '../api/examResults'
import { EXAM_READINESS_PROBLEMS } from '../api/examQuestions'
import type { ExamReadinessProblem } from '../api/examQuestions'
import type { Exam } from '../api/exams'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'
import type { Translate } from '../users/users.format'

/** antd `Tag` preset colours of the three result statuses (`excused` as the attendance's — ATTENDANCE_STATUS_COLORS). */
export const RESULT_STATUS_COLORS: Readonly<Record<ExamResultStatus, string>> = {
  scored: 'green',
  absent: 'red',
  excused: 'blue',
}

/** The exam's title in the active language (the mandatory Arabic as the fallback). */
export function examTitle(exam: Pick<Exam, 'title'>, language: Language): string {
  return localizedLabel(exam.title, language)
}

/** `14 / 18`: students with a recorded result out of the class's active enrollments. */
export function resultsRatio(exam: Pick<Exam, 'results' | 'activeStudents'>): string {
  return `${exam.results.students} / ${exam.activeStudents}`
}

/** Where a readiness problem is put right: the question set of the «الأسئلة» tab, or the settings of the edit form. */
export type ReadinessFix = 'questions' | 'settings'

const FIX_OF_PROBLEM: Readonly<Record<ExamReadinessProblem, ReadinessFix>> = {
  no_questions: 'questions',
  questions_not_ready: 'questions',
  points_mismatch: 'questions',
  window_missing: 'settings',
  duration_missing: 'settings',
  window_closed: 'settings',
}

export function isReadinessProblem(problem: string): problem is ExamReadinessProblem {
  return (EXAM_READINESS_PROBLEMS as readonly string[]).includes(problem)
}

/** Where the problem is put right; null for one this screen does not know (a newer server). */
export function readinessFixOf(problem: string): ReadinessFix | null {
  return isReadinessProblem(problem) ? FIX_OF_PROBLEM[problem] : null
}

/** The server's two numbers behind `points_mismatch`; null when it named none. */
export interface ReadinessNumbers {
  totalPoints: number | null
  maxScore: number | null
}

/**
 * One readiness problem in words (`examOnline.readiness.problems.*`);
 * `points_mismatch` names the two numbers when the server gave them. A problem
 * this screen does not know shows as the server sent it.
 */
export function readinessProblemText(t: Translate, problem: string, numbers: ReadinessNumbers): string {
  if (!isReadinessProblem(problem)) return problem
  if (problem === 'points_mismatch') {
    return numbers.totalPoints === null || numbers.maxScore === null
      ? t('examOnline.readiness.problems.points_mismatch_plain')
      : t('examOnline.readiness.problems.points_mismatch', { total: numbers.totalPoints, max: numbers.maxScore })
  }
  return t(`examOnline.readiness.problems.${problem}`)
}
