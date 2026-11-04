// State of a keyset-paginated table (ADR-028): filters, a stack of cursors
// ("next" pushes the server's `nextCursor`, "back" pops) and the page on
// screen. Any filter change restarts from the first page; in-flight requests
// are aborted and stale answers dropped. The same logic as users/useUsersList
// and courses/useCoursesList, written once for the screens that follow
// (classes first — J-F01).
import { useCallback, useEffect, useMemo, useState } from 'react'

export interface KeysetPage<T> {
  items: T[]
  nextCursor: string | null
}

/**
 * Loads one page for the given filters and cursor. Pass a function defined at
 * module level (a new function on every render would reload in a loop).
 */
export type KeysetLoader<T, F> = (filters: F, cursor: string | undefined, signal: AbortSignal) => Promise<KeysetPage<T>>

interface PageState<T> {
  key: string
  items: T[]
  nextCursor: string | null
  error: unknown
}

export function useKeysetList<T extends { id: string }, F extends object>(load: KeysetLoader<T, F>, initialFilters: F) {
  const [filters, setFiltersState] = useState<F>(initialFilters)
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [reloadTick, setReloadTick] = useState(0)
  const [page, setPage] = useState<PageState<T>>({ key: '', items: [], nextCursor: null, error: null })
  const cursor = cursors[cursors.length - 1]
  const requestKey = JSON.stringify([filters, cursor, reloadTick])
  const loading = page.key !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    load(filters, cursor, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setPage({ key: requestKey, items: result.items, nextCursor: result.nextCursor, error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setPage((current) => ({ ...current, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [load, filters, cursor, requestKey])

  const setFilters = useCallback((patch: Partial<F>) => {
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

  /** Reflects a write in the row on screen without a round trip. */
  const replaceItem = useCallback((item: T) => {
    setPage((current) => ({ ...current, items: current.items.map((row) => (row.id === item.id ? item : row)) }))
  }, [])

  /** Drops a deleted row from the page on screen. */
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
