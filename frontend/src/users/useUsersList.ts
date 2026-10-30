// State of the users table (MOD-03-T11): filters, keyset pagination as a
// stack of cursors (API-012 / ADR-028), and the current page. Every change of
// a filter restarts from the first page; in-flight requests are aborted.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listUsers } from '../api/users'
import type { UserDetail, UserListItem, UserSortField, UserStatus } from '../api/users'

export const PAGE_SIZES = [20, 50, 100] as const

export interface UsersListFilters {
  q: string
  status: UserStatus | undefined
  role: string | undefined
  includeDeleted: boolean
  sort: UserSortField
  limit: (typeof PAGE_SIZES)[number]
}

export const DEFAULT_FILTERS: UsersListFilters = {
  q: '',
  status: undefined,
  role: undefined,
  includeDeleted: false,
  sort: 'createdAt',
  limit: 20,
}

interface PageState {
  /** Identifies the request this page answers; a different key on screen means loading. */
  key: string
  items: UserListItem[]
  nextCursor: string | null
  error: unknown
}

const INITIAL_PAGE: PageState = { key: '', items: [], nextCursor: null, error: null }

/** The list item that corresponds to a detail returned by a write (roles collapse to keys). */
export function listItemOf(user: UserDetail): UserListItem {
  const { roles, studentProfile: _student, employeeProfile: _employee, guardians: _guardians, students: _students, ...summary } = user
  return { ...summary, roles: roles.map((role) => role.key).sort() }
}

export function useUsersList(initialFilters: UsersListFilters = DEFAULT_FILTERS) {
  const [filters, setFiltersState] = useState<UsersListFilters>(initialFilters)
  // cursors[0] is the first page (no cursor); the last entry is the page on screen.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [reloadTick, setReloadTick] = useState(0)
  const [page, setPage] = useState<PageState>(INITIAL_PAGE)
  const cursor = cursors[cursors.length - 1]
  const requestKey = JSON.stringify([filters, cursor, reloadTick])
  const loading = page.key !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    listUsers(
      {
        q: filters.q,
        status: filters.status,
        role: filters.role,
        includeDeleted: filters.includeDeleted,
        sort: filters.sort,
        limit: filters.limit,
        cursor,
      },
      controller.signal,
    )
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

  const setFilters = useCallback((patch: Partial<UsersListFilters>) => {
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

  /** After a creation: default filters, first page, fresh data — the new account is on top. */
  const showNewest = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS)
    setCursors([undefined])
    setReloadTick((tick) => tick + 1)
  }, [])

  /** Reflects a write (API-018) in the row on screen without a round trip. */
  const replaceItem = useCallback((user: UserDetail) => {
    const item = listItemOf(user)
    setPage((current) => ({ ...current, items: current.items.map((row) => (row.id === item.id ? item : row)) }))
  }, [])

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
      showNewest,
      replaceItem,
    }),
    [filters, setFilters, page, loading, cursors.length, next, back, reload, showNewest, replaceItem],
  )
}
