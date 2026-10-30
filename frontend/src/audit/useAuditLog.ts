// State of the audit log table (MOD-03-T15): filters, keyset pagination as a
// stack of cursors (API-011 / ADR-039) and the current page — the pattern of
// users/useUsersList.ts. Every change of a filter restarts from the first
// page; in-flight requests are aborted.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listAuditLogs } from '../api/audit'
import type { AuditLogItem } from '../api/audit'
import { DEFAULT_AUDIT_FILTERS, toListParams } from './audit.query'
import type { AuditFilters } from './audit.query'

interface PageState {
  /** Identifies the request this page answers; a different key on screen means loading. */
  key: string
  items: AuditLogItem[]
  nextCursor: string | null
  error: unknown
}

const INITIAL_PAGE: PageState = { key: '', items: [], nextCursor: null, error: null }

export function useAuditLog(initialFilters: AuditFilters = DEFAULT_AUDIT_FILTERS) {
  const [filters, setFiltersState] = useState<AuditFilters>(initialFilters)
  // cursors[0] is the first page (no cursor); the last entry is the page on screen.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [reloadTick, setReloadTick] = useState(0)
  const [page, setPage] = useState<PageState>(INITIAL_PAGE)
  const cursor = cursors[cursors.length - 1]
  const requestKey = JSON.stringify([filters, cursor, reloadTick])
  const loading = page.key !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    listAuditLogs(toListParams(filters, cursor), controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setPage({ key: requestKey, items: result.items, nextCursor: result.nextCursor, error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        // Keep the rows of the previous page on screen behind the error message.
        setPage((current) => ({ ...current, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [filters, cursor, reloadTick, requestKey])

  const setFilters = useCallback((patch: Partial<AuditFilters>) => {
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

  return useMemo(
    () => ({
      filters,
      setFilters,
      items: page.items,
      nextCursor: page.nextCursor,
      loading,
      error: page.error,
      /** 1-based number of the page on screen. */
      pageNumber: cursors.length,
      canGoBack: cursors.length > 1,
      next,
      back,
      reload,
    }),
    [filters, setFilters, page, loading, cursors.length, next, back, reload],
  )
}
