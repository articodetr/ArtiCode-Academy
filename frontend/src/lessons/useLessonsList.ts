// State of the lessons table (J-F09): API-093 through the shared keyset hook.
// The date filters are calendar days of the academy's zone (D-R41 — J-F28:
// one «day» for a list whose lessons may sit in several zones, as «today» on
// the weekly schedule) turned into the instants the server compares (`from` =
// the first millisecond of the day, `to` = the last).
import { useMemo } from 'react'
import { listLessons } from '../api/lessons'
import type { Lesson, LessonSortOrder, LessonStatus } from '../api/lessons'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'
import { dayEndInstant, dayStartInstant, todayIn } from './lessons.format'

export const LESSON_PAGE_SIZES = [20, 50, 100] as const

export interface LessonsListFilters {
  classId: string | undefined
  /** Lessons assigned to this teacher — offered to managers only (a teacher sees only their classes anyway). */
  teacherId: string | undefined
  status: LessonStatus | undefined
  /** Calendar days (`YYYY-MM-DD`) of the academy's zone; blank = open-ended. */
  from: string | undefined
  to: string | undefined
  order: LessonSortOrder
  limit: (typeof LESSON_PAGE_SIZES)[number]
}

/** Upcoming lessons first: from today (in `dayZone`, the academy's) on, oldest first. */
export function defaultLessonFilters(dayZone: string, now: Date = new Date()): LessonsListFilters {
  return { classId: undefined, teacherId: undefined, status: undefined, from: todayIn(dayZone, now), to: undefined, order: 'asc', limit: 20 }
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

/** API-093 with the filter days of `dayZone` turned into instants. */
function lessonsLoader(dayZone: string): KeysetLoader<Lesson, LessonsListFilters> {
  return (filters, cursor, signal) =>
    listLessons(
      {
        classId: filters.classId,
        teacherId: filters.teacherId,
        status: filters.status,
        from: dayStartInstant(filters.from, dayZone),
        to: dayEndInstant(filters.to, dayZone),
        order: filters.order,
        limit: filters.limit,
        cursor,
      },
      signal,
    )
}

/** `dayZone` = the zone of the filter days (the academy's — useAcademyZone()); the page mounts the list once it is known. */
export function useLessonsList(initialFilters: LessonsListFilters, dayZone: string) {
  // One loader per zone, so the keyset hook never reloads on a re-render.
  const load = useMemo(() => lessonsLoader(dayZone), [dayZone])
  return useKeysetList(load, initialFilters)
}
