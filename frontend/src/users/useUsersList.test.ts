import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { jsonResponse, mockFetch } from '../test/http'
import { makeListItem, makeUserDetail, makeUserList } from '../test/users'
import { DEFAULT_FILTERS, useUsersList } from './useUsersList'

describe('useUsersList', () => {
  it('keeps the rows behind the error of a failed «next» but drops their cursor, so «next» stays off (PR #26 note 4)', async () => {
    const cursors: (string | null)[] = []
    mockFetch((url) => {
      const cursor = new URL(url, 'http://localhost').searchParams.get('cursor')
      cursors.push(cursor)
      return cursor ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : jsonResponse(200, makeUserList([makeListItem()], 'c2'))
    })
    const { result } = renderHook(() => useUsersList())
    await waitFor(() => expect(result.current.nextCursor).toBe('c2'))

    act(() => result.current.next())
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError))
    expect(result.current).toMatchObject({ nextCursor: null, loading: false, pageNumber: 2, canGoBack: true })
    expect(result.current.items).toHaveLength(1)

    act(() => result.current.next())
    expect(result.current.pageNumber).toBe(2)
    expect(cursors).toEqual([null, 'c2'])
  })

  it('asks API-012 for every filter, and showNewest() after a create goes back to the default filters and the first page with exactly one request', async () => {
    const queries: URLSearchParams[] = []
    mockFetch((url) => {
      const query = new URL(url, 'http://localhost').searchParams
      queries.push(query)
      return jsonResponse(200, makeUserList([makeListItem()], query.get('cursor') ? null : 'c2'))
    })
    const { result } = renderHook(() => useUsersList())
    await waitFor(() => expect(result.current.nextCursor).toBe('c2'))
    act(() => result.current.setFilters({ q: ' sara ', status: 'active', role: 'teacher', includeDeleted: true, sort: 'fullName', limit: 50 }))
    await waitFor(() => expect(result.current.nextCursor).toBe('c2'))
    act(() => result.current.next())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const filtered = { q: 'sara', status: 'active', role: 'teacher', includeDeleted: 'true', sort: 'fullName', limit: '50' }
    expect(queries.map((query) => Object.fromEntries(query))).toEqual([{ sort: 'createdAt', limit: '20' }, filtered, { ...filtered, cursor: 'c2' }])
    expect(result.current).toMatchObject({ pageNumber: 2, canGoBack: true })

    act(() => result.current.showNewest())
    expect(queries).toHaveLength(4)
    expect(Object.fromEntries(queries[3]!)).toEqual({ sort: 'createdAt', limit: '20' })
    expect(result.current).toMatchObject({ filters: DEFAULT_FILTERS, loading: true, pageNumber: 1, canGoBack: false })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(queries).toHaveLength(4)
  })

  it('showNewest() on the default first page reads it again, once, so the new account shows on top', async () => {
    const created = makeListItem({ id: '0192f0a0-0000-7000-8000-000000000009', fullName: 'حساب جديد', status: 'invited', roles: ['student'] })
    let reads = 0
    const fetchMock = mockFetch(() => jsonResponse(200, reads++ === 0 ? makeUserList([makeListItem()]) : makeUserList([created, makeListItem()])))
    const { result } = renderHook(() => useUsersList())
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    act(() => result.current.showNewest())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]![0])).toBe('/api/users?sort=createdAt&limit=20')
    expect(result.current).toMatchObject({ filters: DEFAULT_FILTERS, loading: true, pageNumber: 1 })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items.map((item) => item.id)).toEqual([created.id, makeListItem().id])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('replaceItem() puts the list item of a written detail in its row: role keys sorted, no profile or links, no request', async () => {
    const sara = makeListItem()
    const omar = makeListItem({ id: '0192f0a0-0000-7000-8000-000000000002', fullName: 'عمر خالد', roles: ['student'] })
    const fetchMock = mockFetch(() => jsonResponse(200, makeUserList([sara, omar])))
    const { result } = renderHook(() => useUsersList())
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    const untouched = result.current.items[0]

    // A write (API-018, API-027/028, API-030) answers with the detail: roles as { key, label } in server order, profiles and links.
    const written = makeUserDetail({
      id: omar.id,
      fullName: 'عمر خالد محمود',
      status: 'active',
      roles: [
        { key: 'student', label: { ar: 'طالب', en: 'Student' } },
        { key: 'guardian', label: { ar: 'ولي أمر', en: 'Guardian' } },
      ],
    })
    act(() => result.current.replaceItem(written))

    const [first, second] = result.current.items
    expect(first).toBe(untouched)
    expect(first).toEqual(sara)
    expect(Object.keys(second!).sort()).toEqual(Object.keys(omar).sort())
    expect(second).toMatchObject({ id: omar.id, fullName: 'عمر خالد محمود', status: 'active', email: written.email, createdAt: written.createdAt, roles: ['guardian', 'student'] })
    expect(result.current.loading).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns the same members on every render, with showNewest and replaceItem kept by identity for the drawer and the wizard', async () => {
    mockFetch((url) => jsonResponse(200, makeUserList([makeListItem()], new URL(url, 'http://localhost').searchParams.get('cursor') ? null : 'c2')))
    const { result } = renderHook(() => useUsersList())
    await waitFor(() => expect(result.current.nextCursor).toBe('c2'))
    const { showNewest, replaceItem } = result.current
    expect(Object.keys(result.current).sort()).toEqual([
      'back',
      'canGoBack',
      'error',
      'filters',
      'items',
      'loading',
      'next',
      'nextCursor',
      'pageNumber',
      'reload',
      'replaceItem',
      'setFilters',
      'showNewest',
    ])

    act(() => result.current.next())
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.setFilters({ q: 'omar' }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.showNewest())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.showNewest).toBe(showNewest)
    expect(result.current.replaceItem).toBe(replaceItem)
  })
})
