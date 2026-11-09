import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { LEVEL_ID, makeCourse, makeCourseList } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { useCoursesList } from './useCoursesList'

describe('useCoursesList', () => {
  it('drops the cursor of the old filters when the new filters fail to load, so «next» stays off (PR #26 note 4)', async () => {
    const queries: URLSearchParams[] = []
    mockFetch((url) => {
      const query = new URL(url, 'http://localhost').searchParams
      queries.push(query)
      return query.get('status') ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : jsonResponse(200, makeCourseList([makeCourse()], 'c2'))
    })
    const { result } = renderHook(() => useCoursesList())
    await waitFor(() => expect(result.current.nextCursor).toBe('c2'))

    act(() => result.current.setFilters({ status: 'archived' }))
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError))
    expect(result.current).toMatchObject({ nextCursor: null, loading: false, pageNumber: 1, canGoBack: false })
    expect(result.current.items).toHaveLength(1)

    act(() => result.current.next())
    expect(result.current.pageNumber).toBe(1)
    expect(queries.map((query) => query.get('cursor'))).toEqual([null, null])
  })

  it('asks API-042 for every filter and the cursor of the page on screen, and returns the members of a keyset list with row replacement and removal', async () => {
    const queries: URLSearchParams[] = []
    mockFetch((url) => {
      const query = new URL(url, 'http://localhost').searchParams
      queries.push(query)
      return jsonResponse(200, makeCourseList([makeCourse()], query.get('cursor') ? null : 'c2'))
    })
    const { result } = renderHook(() => useCoursesList({ q: ' py ', status: 'published', levelId: LEVEL_ID, sort: 'createdAt', limit: 50 }))
    await waitFor(() => expect(result.current.nextCursor).toBe('c2'))
    act(() => result.current.next())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const filtered = { q: 'py', status: 'published', levelId: LEVEL_ID, sort: 'createdAt', limit: '50' }
    expect(queries.map((query) => Object.fromEntries(query))).toEqual([filtered, { ...filtered, cursor: 'c2' }])
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
      'removeItem',
      'replaceItem',
      'setFilters',
    ])
  })
})
