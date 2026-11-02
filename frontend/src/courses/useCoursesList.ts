// State of the courses table (MOD-04-T05), on the pattern of
// users/useUsersList.ts: filters, keyset pagination as a stack of cursors
// (API-042 / ADR-028) and the page on screen. Any filter change restarts from
// the first page; in-flight requests are aborted.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listCourses } from '../api/courses'
import type { Course, CourseSortField, CourseStatus } from '../api/courses'

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

interface PageState {
  key: string
  items: Course[]
  nextCursor: string | null
  error: unknown
}

const INITIAL_PAGE: PageState = { key: '', items: [], nextCursor: null, error: null }

export function useCoursesList(initialFilters: CoursesListFilters = DEFAULT_COURSE_FILTERS) {
  const [filters, setFiltersState] = useState<CoursesListFilters>(initialFilters)
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [reloadTick, setReloadTick] = useState(0)
  const [page, setPage] = useState<PageState>(INITIAL_PAGE)
  const cursor = cursors[cursors.length - 1]
  const requestKey = JSON.stringify([filters, cursor, reloadTick])
  const loading = page.key !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    listCourses(
      { q: filters.q, status: filters.status, levelId: filters.levelId, sort: filters.sort, limit: filters.limit, cursor },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return
        setPage({ key: requestKey, items: result.items, nextCursor: result.nextCursor, error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setPage((current) => ({ ...current, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [filters, cursor, reloadTick, requestKey])

  const setFilters = useCallback((patch: Partial<CoursesListFilters>) => {
    setFiltersState((current) => ({ ...current, ...patch }))
    setCursors([undefined])
  }, [])

  const next = useCallback(() => {
    const nextCursor = page.nextCursor
    if (nextCursor) setCursors((stack) => [...stack, nextCursor])
  }, [page.nextCursor])

  const back = useCallback(() => {
    setCursors((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack))
  }, [])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  /** Reflects a write (API-045/API-046) in the row on screen without a round trip. */
  const replaceItem = useCallback((course: Course) => {
    setPage((current) => ({ ...current, items: current.items.map((row) => (row.id === course.id ? course : row)) }))
  }, [])

  /** Drops a deleted draft (API-047) from the page on screen. */
  const removeItem = useCallback((id: string) => {
    setPage((current) => ({ ...current, items: current.items.filter((row) => row.id !== id) }))
  }, [])

  return useMemo(
    () => ({
      filters,
      setFilters,
      items: page.items,
      nextCursor: page.nextCursor,
      loading,
      error: page.error,
      pageNumber: cursors.length,
      canGoBack: cursors.length > 1,
      next,
      back,
      reload,
      replaceItem,
      removeItem,
    }),
    [filters, setFilters, page, loading, cursors.length, next, back, reload, replaceItem, removeItem],
  )
}
