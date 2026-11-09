// State of the users table (MOD-03-T11): API-012 through the shared keyset hook
// (common/useKeysetList.ts, since J-F31) — filters, keyset pagination as a
// stack of cursors (ADR-028) and the current page. Every change of a filter
// restarts from the first page; in-flight requests are aborted. The users
// screen adds showNewest() and a replaceItem() that takes a write's detail.
import { useCallback, useMemo } from 'react'
import { listUsers } from '../api/users'
import type { UserDetail, UserListItem, UserSortField, UserStatus } from '../api/users'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'

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

/** The list item that corresponds to a detail returned by a write (roles collapse to keys). */
export function listItemOf(user: UserDetail): UserListItem {
  const { roles, studentProfile: _student, employeeProfile: _employee, guardians: _guardians, students: _students, ...summary } = user
  return { ...summary, roles: roles.map((role) => role.key).sort() }
}

const loadUsers: KeysetLoader<UserListItem, UsersListFilters> = (filters, cursor, signal) =>
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
    signal,
  )

export function useUsersList(initialFilters: UsersListFilters = DEFAULT_FILTERS) {
  const list = useKeysetList(loadUsers, initialFilters)
  const { setFilters, reload, replaceItem: replaceRow } = list

  /**
   * After a creation: default filters, first page, fresh data — the new account is on top.
   * DEFAULT_FILTERS names every filter, so the merge replaces them all; both updates land
   * in one render, hence one request.
   */
  const showNewest = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
    reload()
  }, [setFilters, reload])

  /** Reflects a write (API-018) in the row on screen without a round trip. */
  const replaceItem = useCallback((user: UserDetail) => replaceRow(listItemOf(user)), [replaceRow])

  return useMemo(() => {
    // A deletion is soft and answers with the detail (replaceItem): no row leaves the page.
    const { removeItem: _removeItem, ...state } = list
    return { ...state, showNewest, replaceItem }
  }, [list, showNewest, replaceItem])
}
