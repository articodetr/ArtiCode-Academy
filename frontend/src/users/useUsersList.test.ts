import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { jsonResponse, mockFetch } from '../test/http'
import { makeListItem, makeUserList } from '../test/users'
import { useUsersList } from './useUsersList'

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
})
