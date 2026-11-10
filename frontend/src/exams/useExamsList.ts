// State of the exams table (J-F45): API-113 through the shared keyset hook,
// with the filters the contract supports — class, status, type, a date range
// and the order (by exam date, undated exams last). The two days of the range
// are calendar days of `timeZone` (the academy's — this device's until it is
// known — exams.zone.ts) turned into the instants the server compares: `from` =
// the first millisecond of the day, `to` = the last. No default range: an
// undated exam (a fresh draft) never matches one, so a default would hide it.
import { listExams } from '../api/exams'
import type { Exam, ExamSortOrder, ExamStatus, ExamType } from '../api/exams'
import { dayEndIn, dayStartIn } from '../assignments/assignments.zone'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'

export const EXAM_PAGE_SIZES = [20, 50, 100] as const

export interface ExamsListFilters {
  classId: string | undefined
  status: ExamStatus | undefined
  type: ExamType | undefined
  /** Calendar days (`YYYY-MM-DD`) of `timeZone`; blank = open-ended. */
  from: string | undefined
  to: string | undefined
  /** The zone the two days are read in. */
  timeZone: string
  order: ExamSortOrder
  limit: (typeof EXAM_PAGE_SIZES)[number]
}

/** Every exam by date, earliest first (the server's default order), 20 per page. */
export function defaultExamFilters(timeZone: string): ExamsListFilters {
  return { classId: undefined, status: undefined, type: undefined, from: undefined, to: undefined, timeZone, order: 'asc', limit: 20 }
}

/** True when the list is narrowed: a class, a status, a type or a day (the order, the page size and the zone narrow nothing). */
export function hasActiveExamFilters(filters: ExamsListFilters): boolean {
  return Boolean(filters.classId || filters.status || filters.type || filters.from || filters.to)
}

const loadExams: KeysetLoader<Exam, ExamsListFilters> = (filters, cursor, signal) =>
  listExams(
    {
      classId: filters.classId,
      status: filters.status,
      type: filters.type,
      from: dayStartIn(filters.from, filters.timeZone),
      to: dayEndIn(filters.to, filters.timeZone),
      order: filters.order,
      limit: filters.limit,
      cursor,
    },
    signal,
  )

export function useExamsList(initialFilters: ExamsListFilters) {
  return useKeysetList(loadExams, initialFilters)
}
