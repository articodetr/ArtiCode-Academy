// Pure labels of the exam screens (J-F45): the title in the active language,
// the «recorded / total» ratio of the results and the colours of the result
// statuses — every number is the server's (no grade is computed here). Instants
// are formatted with the assignments' zoned formatters (assignments.format.ts)
// in the exam's `timeZone` (D-R41). No React, no i18next instance.
import type { ExamResultStatus } from '../api/examResults'
import type { Exam } from '../api/exams'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'

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
