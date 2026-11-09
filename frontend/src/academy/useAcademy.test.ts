import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { useAcademy } from './useAcademy'

/** Serves GET /api/academy with one answer per request (the last one repeats) and counts the requests. */
function serveAcademy(...answers: Array<() => Response | Promise<Response>>) {
  let gets = 0
  mockFetch((url, init) => {
    if (url !== '/api/academy' || (init?.method ?? 'GET') !== 'GET') return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
    const answer = answers[Math.min(gets, answers.length - 1)]
    gets += 1
    return answer()
  })
  return { gets: () => gets }
}

const notConfigured = () => jsonResponse(503, { statusCode: 503, error: 'Service Unavailable', code: 'academy_not_configured', message: 'seed' })

describe('useAcademy — one read shared by every reader (J-F13)', () => {
  it('gives every reader the answer of a single GET, and reads afresh once the last reader has unmounted', async () => {
    const academy = makeAcademy()
    const api = serveAcademy(() => jsonResponse(200, academy))
    const header = renderHook(() => useAcademy())
    const settings = renderHook(() => useAcademy())
    expect(header.result.current).toMatchObject({ academy: null, loading: true, error: null })

    await waitFor(() => expect(header.result.current.academy).toEqual(academy))
    expect(settings.result.current.academy).toBe(header.result.current.academy)
    expect(settings.result.current.loading).toBe(false)
    expect(api.gets()).toBe(1)

    header.unmount()
    settings.unmount()
    const later = renderHook(() => useAcademy())
    expect(later.result.current.academy).toBeNull()
    await waitFor(() => expect(later.result.current.academy).toEqual(academy))
    expect(api.gets()).toBe(2)
  })

  it('shows a failure to every reader, and reload() and replace() reach them all', async () => {
    const api = serveAcademy(notConfigured, () => jsonResponse(200, makeAcademy()))
    const header = renderHook(() => useAcademy())
    const settings = renderHook(() => useAcademy())

    await waitFor(() => expect(header.result.current.error).toMatchObject({ status: 503, code: 'academy_not_configured' }))
    expect(settings.result.current.error).toBe(header.result.current.error)
    expect(header.result.current).toMatchObject({ academy: null, loading: false })

    act(() => settings.result.current.reload())
    expect(header.result.current.loading).toBe(true)
    await waitFor(() => expect(header.result.current.academy).not.toBeNull())
    expect(header.result.current.error).toBeNull()

    const saved = makeAcademy({ name: { ar: 'أكاديمية الفجر' }, updatedAt: '2026-11-09T08:00:00.000Z' })
    act(() => settings.result.current.replace(saved))
    expect(header.result.current.academy).toBe(saved)
    expect(api.gets()).toBe(2)
  })

  it('keeps a write answer when a read that was already in flight comes back after it', async () => {
    let answerStaleRead: (response: Response) => void = () => {}
    const api = serveAcademy(
      () => jsonResponse(200, makeAcademy()),
      () =>
        new Promise<Response>((resolve) => {
          answerStaleRead = resolve
        }),
    )
    const reader = renderHook(() => useAcademy())
    await waitFor(() => expect(reader.result.current.academy).not.toBeNull())

    act(() => reader.result.current.reload())
    expect(api.gets()).toBe(2)
    const saved = makeAcademy({ name: { ar: 'أكاديمية الفجر' }, updatedAt: '2026-11-09T08:00:00.000Z' })
    act(() => reader.result.current.replace(saved))

    const stale = jsonResponse(200, makeAcademy())
    answerStaleRead(stale)
    // The stale answer is read to the end, then ignored.
    await waitFor(() => expect(stale.bodyUsed).toBe(true))
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(reader.result.current.academy).toBe(saved)
    expect(reader.result.current.loading).toBe(false)
  })
})
