import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { jsonResponse, mockFetch } from '../test/http'
import { makeBranchOption } from '../test/timetable'
import { useTimetableBranches } from './useTimetableBranches'

describe('useTimetableBranches (J-F18 — one branches client)', () => {
  it('reads API-080 through the shared branches client, once and only while enabled', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { items: [makeBranchOption()] }))
    const { result, rerender } = renderHook(({ enabled }) => useTimetableBranches(enabled), { initialProps: { enabled: false } })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current).toEqual({ loaded: false, items: [] })

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.items.map((branch) => `${branch.code}:${branch.isActive}`)).toEqual(['IST:true'])
    rerender({ enabled: true })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/branches'])
  })

  it('reads a failure as no branches, so the branch filter stays hidden', async () => {
    mockFetch(() => jsonResponse(500, { statusCode: 500, message: 'Internal Server Error' }))
    const { result } = renderHook(() => useTimetableBranches(true))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.items).toEqual([])
  })
})
