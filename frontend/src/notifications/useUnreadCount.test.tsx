import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, mockFetch } from '../test/http'
import { UNREAD_POLL_MS, refreshUnreadCount, useUnreadCount } from './useUnreadCount'

function Probe() {
  const { unread } = useUnreadCount()
  return <output data-testid="unread">{unread ?? '—'}</output>
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useUnreadCount (API-168)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    setVisibility('visible')
    vi.useRealTimers()
  })

  it('asks at mount and every 60 s while visible, pauses while hidden and asks again when shown', async () => {
    let count = 0
    const fetchMock = mockFetch(() => jsonResponse(200, { unread: ++count }))
    const { getByTestId } = render(<Probe />)
    await act(async () => {})
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getByTestId('unread')).toHaveTextContent('1')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNREAD_POLL_MS)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]![0])).toBe('/api/me/notifications/unread-count')

    act(() => setVisibility('hidden'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNREAD_POLL_MS * 3)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      setVisibility('visible')
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await act(async () => {
      refreshUnreadCount()
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(getByTestId('unread')).toHaveTextContent('4')
  })
})
