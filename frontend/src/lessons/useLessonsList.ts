// State of the lessons table (J-F09): API-093 through the shared keyset hook.
// The date filters are local calendar days turned into the instants the
// server compares (`from` = the first millisecond of the day, `to` = the last).
import { listLessons } from '../api/lessons'
import type { Lesson, LessonSortOrder, LessonStatus } from '../api/lessons'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'
import { dayEndInstant, dayStartInstant, todayIso } from './lessons.format'

export const LESSON_PAGE_SIZES = [20, 50, 100] as const

export interface LessonsListFilters {
  classId: string | undefined
  /** Lessons assigned to this teacher — offered to managers only (a teacher sees only their classes anyway). */
  teacherId: string | undefined
  status: LessonStatus | undefined
  /** Local calendar days (`YYYY-MM-DD`); blank = open-ended. */
  from: string | undefined
  to: string | undefined
  order: LessonSortOrder
  limit: (typeof LESSON_PAGE_SIZES)[number]
}

/** Upcoming lessons first: from today on, oldest first. */
export function defaultLessonFilters(now: Date = new Date()): LessonsListFilters {
  return { classId: undefined, teacherId: undefined, status: undefined, from: todayIso(now), to: undefined, order: 'asc', limit: 20 }
}

/**
 * True when the list is narrowed beyond its defaults — a class, a teacher, a
 * status, an end day, or a start day other than the default one (cleared
 * included). The default «from today» alone is not a filter, so an empty list
 * then says «no lessons from today on», not «nothing matches the filters».
 */
export function hasActiveLessonFilters(filters: LessonsListFilters, defaults: LessonsListFilters): boolean {
  return Boolean(filters.classId || filters.teacherId || filters.status || filters.to) || filters.from !== defaults.from
}

const loadLessons: KeysetLoader<Lesson, LessonsListFilters> = (filters, cursor, signal) =>
  listLessons(
    {
      classId: filters.classId,
      teacherId: filters.teacherId,
      status: filters.status,
      from: dayStartInstant(filters.from),
      to: dayEndInstant(filters.to),
      order: filters.order,
      limit: filters.limit,
      cursor,
    },
    signal,
  )

export function useLessonsList(initialFilters: LessonsListFilters = defaultLessonFilters()) {
  return useKeysetList(loadLessons, initialFilters)
}
