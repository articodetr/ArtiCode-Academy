// State of the courses table (MOD-04-T05): API-042 through the shared keyset
// hook (common/useKeysetList.ts, since J-F31) — filters, keyset pagination as
// a stack of cursors (ADR-028), the page on screen, a written row (API-045/
// API-046) replaced and a deleted draft (API-047) removed without a round
// trip. Any filter change restarts from the first page; in-flight requests are
// aborted.
import { listCourses } from '../api/courses'
import type { Course, CourseSortField, CourseStatus } from '../api/courses'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'

export const COURSE_PAGE_SIZES = [20, 50, 100] as const

export interface CoursesListFilters {
  q: string
  status: CourseStatus | undefined
  levelId: string | undefined
  sort: CourseSortField
  limit: (typeof COURSE_PAGE_SIZES)[number]
}

export const DEFAULT_COURSE_FILTERS: CoursesListFilters = {
  q: '',
  status: undefined,
  levelId: undefined,
  sort: 'code',
  limit: 20,
}

const loadCourses: KeysetLoader<Course, CoursesListFilters> = (filters, cursor, signal) =>
  listCourses({ q: filters.q, status: filters.status, levelId: filters.levelId, sort: filters.sort, limit: filters.limit, cursor }, signal)

export function useCoursesList(initialFilters: CoursesListFilters = DEFAULT_COURSE_FILTERS) {
  return useKeysetList(loadCourses, initialFilters)
}
