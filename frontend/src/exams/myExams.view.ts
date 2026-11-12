// Pure rules of «my exams» (J-F50): the filters turned into API-121
// parameters, the row key (an exam repeats once per owned student) and the
// result cell — the student's own result only when the server sends it (once
// the results are published, D-R47). The two days of the date filter are
// calendar days of `timeZone` (the academy's — this device's until it is
// known — as on /exams) turned into the instants the server compares: `from` =
// the first millisecond of the day, `to` = the last. No default range: an
// undated scheduled exam never matches one, so a default would hide it. The
// student and class filter options, and the student column rule, are those of
// «my lessons» (lessons/myLessons.view.ts — the same API-060 ownership). No
// React, no i18next instance; unit-tested in myExams.view.test.ts.
import type { ExamResultStatus } from '../api/examResults'
import type { ExamSortOrder } from '../api/exams'
import type { ListMyExamsParams, MyExamItem, MyExamStatus } from '../api/myExams'
import { dayEndIn, dayStartIn } from '../assignments/assignments.zone'

/** Exams per page (`limit` counts exams — a page can hold more rows). */
export const MY_EXAM_PAGE_SIZES = [20, 50, 100] as const

export interface MyExamsFilters {
  /** The caller or one of their children; blank = every owned student. */
  studentId: string | undefined
  classId: string | undefined
  /** `scheduled` or `published`; blank = both (drafts are never listed). */
  status: MyExamStatus | undefined
  /** Calendar days (`YYYY-MM-DD`) of `timeZone`; blank = open-ended. */
  from: string | undefined
  to: string | undefined
  /** The zone the two days are read in. */
  timeZone: string
  /** By exam date (undated last), then id. */
  order: ExamSortOrder
  limit: (typeof MY_EXAM_PAGE_SIZES)[number]
}

/** Every owned exam by date, earliest first (the server's default order), 20 per page. */
export function defaultMyExamsFilters(timeZone: string): MyExamsFilters {
  return { studentId: undefined, classId: undefined, status: undefined, from: undefined, to: undefined, timeZone, order: 'asc', limit: 20 }
}

/** API-121 parameters of the filters (the cursor is added by the caller). */
export function myExamsQuery(filters: MyExamsFilters): ListMyExamsParams {
  return {
    classId: filters.classId,
    studentId: filters.studentId,
    status: filters.status,
    from: dayStartIn(filters.from, filters.timeZone),
    to: dayEndIn(filters.to, filters.timeZone),
    order: filters.order,
    limit: filters.limit,
  }
}

/** True when a filter narrows the list (the empty text then says so) — never the order, the page size or the zone. */
export function isNarrowed(filters: MyExamsFilters): boolean {
  return Boolean(filters.studentId || filters.classId || filters.status || filters.from || filters.to)
}

/** A row is an exam × a student: the exam id alone repeats for a guardian with two children in the class. */
export function myExamKey(item: Pick<MyExamItem, 'id' | 'student'>): string {
  return `${item.id}:${item.student.id}`
}

export type MyExamResultCell =
  /** The student's own result as the server sent it; `score` with `scored` only. */
  | { kind: 'result'; status: ExamResultStatus; score: number | null }
  /** The results are not published yet: the server sends none (D-R47). */
  | { kind: 'awaiting' }
  /** The results are published, and this student has none recorded. */
  | { kind: 'none' }

/** What the result column shows. */
export function resultCellOf(item: Pick<MyExamItem, 'status' | 'result'>): MyExamResultCell {
  if (item.result) return { kind: 'result', status: item.result.status, score: item.result.status === 'scored' ? item.result.score : null }
  return item.status === 'published' ? { kind: 'none' } : { kind: 'awaiting' }
}
