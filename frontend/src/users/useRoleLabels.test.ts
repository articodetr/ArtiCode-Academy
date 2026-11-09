import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { AuthContext } from '../auth/auth-context'
import type { FetchHandler } from '../test/http'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser } from '../test/render'
import { ROLE_LABELS, ROLE_OPTIONS, makeRoleList } from '../test/users'
import { useRoleLabels } from './useRoleLabels'

/** Mounts the hook for a signed-in user holding `permissions`; `enabled` as the profile page passes it. */
function renderLabels(permissions: string[], enabled?: boolean) {
  const auth = makeAuth({ user: makeUser({ permissions }) })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(AuthContext, { value: auth }, children)
  return renderHook(() => useRoleLabels(enabled), { wrapper })
}

/** Answers every request with `handler` and records the paths asked for. */
function record(handler: FetchHandler) {
  const paths: string[] = []
  const fetchMock = mockFetch((url, init) => {
    paths.push(url)
    return handler(url, init)
  })
  return { paths, fetchMock }
}

describe('useRoleLabels (J-F12)', () => {
  it('reads GET /api/roles once and keys the labels in the active language, in server order', async () => {
    const api = record(() => jsonResponse(200, makeRoleList()))
    const { result, rerender } = renderLabels(['users.read'])

    await waitFor(() => expect(result.current.labels.get('librarian')).toBe(ROLE_LABELS.librarian.ar))
    expect(result.current.keys).toEqual(ROLE_OPTIONS.map((role) => role.key))
    // The roles themselves too, for the drawer's roles tab (J-F23 — PR #62 review, note 1).
    expect(result.current.items).toEqual(ROLE_OPTIONS)
    rerender()
    rerender()
    expect(api.paths).toEqual(['/api/roles'])
  })

  it('asks nothing without users.read (the permission of API-022) and stays empty', async () => {
    const api = record(() => jsonResponse(200, makeRoleList()))
    const { result } = renderLabels(['users.create'])

    await act(async () => {})
    expect(api.paths).toEqual([])
    expect(result.current.labels.size).toBe(0)
    expect(result.current.keys).toEqual([])
    expect(result.current.items).toBeNull()
  })

  it('asks nothing when disabled, even with users.read (the profile page of a user without a custom role — J-F36)', async () => {
    const api = record(() => jsonResponse(200, makeRoleList()))
    const { result } = renderLabels(['users.read'], false)

    await act(async () => {})
    expect(api.paths).toEqual([])
    expect(result.current.labels.size).toBe(0)
  })

  it('stays empty without throwing when the request fails', async () => {
    const api = record(() => jsonResponse(500, { statusCode: 500, message: 'Internal server error' }))
    const { result } = renderLabels(['users.read'])

    await waitFor(() => expect(api.paths).toEqual(['/api/roles']))
    await act(async () => {})
    expect(result.current.labels.size).toBe(0)
    expect(result.current.keys).toEqual([])
    expect(result.current.items).toBeNull()
  })

  it('aborts the request when the page unmounts', async () => {
    let signal: AbortSignal | null | undefined
    record((_url, init) => {
      signal = init?.signal
      return new Promise<Response>(() => {})
    })
    const { unmount } = renderLabels(['users.read'])

    await waitFor(() => expect(signal).toBeTruthy())
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
