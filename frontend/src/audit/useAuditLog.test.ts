import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { makeAuditItem, makeAuditList } from '../test/audit'
import { jsonResponse, mockFetch } from '../test/http'
import { DEFAULT_AUDIT_FILTERS } from './audit.query'
import { useAuditLog } from './useAuditLog'

describe('useAuditLog', () => {
  it('keeps the rows behind the error of a failed «next» but drops their cursor, so «next» stays off (PR #26 note 4)', async () => {
    const cursors: (string | null)[] = []
    mockFetch((url) => {
      const cursor = new URL(url, 'http://localhost').searchParams.get('cursor')
      cursors.push(cursor)
      return cursor ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : jsonResponse(200, makeAuditList([makeAuditItem()], 'c2'))
    })
    const { result } = renderHook(() => useAuditLog())
    await waitFor(() => expect(result.current.nextCursor).toBe('c2'))

    act(() => result.current.next())
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError))
    expect(result.current).toMatchObject({ nextCursor: null, loading: false, pageNumber: 2, canGoBack: true })
    expect(result.current.items).toHaveLength(1)

    act(() => result.current.next())
    expect(result.current.pageNumber).toBe(2)
    expect(cursors).toEqual([null, 'c2'])
  })

  it('asks API-011 for the initial filters through toListParams, and returns a read-only list: no row replacement or removal', async () => {
    const queries: URLSearchParams[] = []
    mockFetch((url) => {
      const query = new URL(url, 'http://localhost').searchParams
      queries.push(query)
      return jsonResponse(200, makeAuditList([makeAuditItem()], query.get('cursor') ? null : 'c2'))
    })
    const { result } = renderHook(() => useAuditLog({ ...DEFAULT_AUDIT_FILTERS, action: ' users. ', entityType: 'users', entityId: 'abc', limit: 20 }))
    await waitFor(() => expect(result.current.nextCursor).toBe('c2'))
    act(() => result.current.next())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const filtered = { action: 'users.', entityType: 'users', entityId: 'abc', limit: '20' }
    expect(queries.map((query) => Object.fromEntries(query))).toEqual([filtered, { ...filtered, cursor: 'c2' }])
    expect(Object.keys(result.current).sort()).toEqual(['back', 'canGoBack', 'error', 'filters', 'items', 'loading', 'next', 'nextCursor', 'pageNumber', 'reload', 'setFilters'])
  })
})
