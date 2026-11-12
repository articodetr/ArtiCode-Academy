import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, mockFetch } from '../test/http'
import { UNREAD_POLL_MS, refreshUnreadCount, useUnreadCount } from './useUnreadCount'

const COUNT_PATH = '/api/me/notifications/unread-count'

/** Lets the stubbed fetch answer: a few real macrotasks inside act (setTimeout is never faked here). */
async function settle() {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Serves the count (the value of `current()` at each request) and records the requests. */
function serveCount(current: () => number) {
  return mockFetch((url) => (url === COUNT_PATH ? jsonResponse(200, { unread: current() }) : jsonResponse(404, {})))
}

describe('useUnreadCount (API-168, D-R86)', () => {
  afterEach(() => {
    vi.useRealTimers()
    // Back to jsdom's own getter ('visible').
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('asks at once and then every 60 seconds while the page is visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let unread = 2
    const fetchMock = serveCount(() => unread)
    const { result, unmount } = renderHook(() => useUnreadCount())

    await settle()
    expect(result.current).toEqual({ unread: 2, error: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    unread = 5
    act(() => {
      vi.advanceTimersByTime(UNREAD_POLL_MS - 1)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    await settle()
    expect(result.current.unread).toBe(5)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(UNREAD_POLL_MS).toBe(60_000)
    unmount()
  })

  it('stops polling while the page is hidden and asks again the moment it shows', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let unread = 1
    const fetchMock = serveCount(() => unread)
    const { result, unmount } = renderHook(() => useUnreadCount())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    act(() => setVisibility('hidden'))
    unread = 4
    act(() => {
      vi.advanceTimersByTime(UNREAD_POLL_MS * 3)
    })
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.unread).toBe(1)
    // A mark-read elsewhere while hidden asks nothing either: the count is read when the page shows.
    act(() => refreshUnreadCount())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    act(() => setVisibility('visible'))
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.unread).toBe(4)
    act(() => {
      vi.advanceTimersByTime(UNREAD_POLL_MS)
    })
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    unmount()
  })

  it('shares one reading between readers, refreshes on demand, and stops when the last reader leaves', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let unread = 3
    const fetchMock = serveCount(() => unread)
    const first = renderHook(() => useUnreadCount())
    const second = renderHook(() => useUnreadCount())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second.result.current.unread).toBe(3)

    unread = 0
    act(() => refreshUnreadCount())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(first.result.current.unread).toBe(0)
    expect(second.result.current.unread).toBe(0)

    first.unmount()
    second.unmount()
    act(() => {
      vi.advanceTimersByTime(UNREAD_POLL_MS * 2)
    })
    act(() => refreshUnreadCount())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the last count when a read fails, and starts afresh for the next reader', async () => {
    let fail = false
    const fetchMock = mockFetch((url) => {
      if (url !== COUNT_PATH) return jsonResponse(404, {})
      return fail ? jsonResponse(500, { statusCode: 500, message: 'down' }) : jsonResponse(200, { unread: 7 })
    })
    const { result, unmount } = renderHook(() => useUnreadCount())
    await settle()
    expect(result.current.unread).toBe(7)

    fail = true
    act(() => refreshUnreadCount())
    await settle()
    expect(result.current.unread).toBe(7)
    expect(result.current.error).toMatchObject({ status: 500 })
    unmount()

    const next = renderHook(() => useUnreadCount())
    expect(next.result.current).toEqual({ unread: null, error: null })
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    next.unmount()
  })
})
