// The unread count for the header bell (MOD-12-T07, D-R86): GET
// /api/me/notifications/unread-count (API-168) at mount and every 60 s while
// the page is visible — the timer stops while `document.visibilityState` is
// not 'visible' and the count is asked again the moment the page shows. The
// notifications page calls refreshUnreadCount() after every mark-read, so a
// mounted bell follows at once instead of at the next poll. A failed read
// keeps the last count. A 401 (the session ended — signed out in another tab, or expired) stops the polling
// until the page is shown again (redesign: a tab left open asked every minute and got 401 forever).
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { getUnreadCount } from '../api/notifications'

/** D-R86: how often the count is asked while the page is visible. */
export const UNREAD_POLL_MS = 60_000

const REFRESH_EVENT = 'articode:notifications-unread'

/** Asks every mounted useUnreadCount() to read the count now (after a mark-read). */
export function refreshUnreadCount(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REFRESH_EVENT))
}

export interface UnreadCount {
  /** null until the first answer arrives. */
  unread: number | null
  /** The last failure, or null; the last count stays behind it. */
  error: unknown
  refresh: () => void
}

function pageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

export function useUnreadCount(): UnreadCount {
  const [unread, setUnread] = useState<number | null>(null)
  const [error, setError] = useState<unknown>(null)
  const inFlight = useRef<AbortController | null>(null)
  /** Set on a 401: the poll stops until the page becomes visible again. */
  const signedOut = useRef(false)
  const stopPolling = useRef<() => void>(() => {})

  const load = useCallback(() => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    getUnreadCount(controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return
        setUnread(answer.unread)
        setError(null)
      },
      (caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught)
        if (caught instanceof ApiError && caught.status === 401) {
          signedOut.current = true
          stopPolling.current()
        }
      },
    )
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    const stop = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }
    stopPolling.current = stop
    const start = () => {
      stop()
      signedOut.current = false
      load()
      timer = setInterval(load, UNREAD_POLL_MS)
    }
    const onVisibility = () => (pageVisible() ? start() : stop())
    const onRefresh = () => {
      if (pageVisible() && !signedOut.current) load()
    }
    if (pageVisible()) start()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener(REFRESH_EVENT, onRefresh)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(REFRESH_EVENT, onRefresh)
      inFlight.current?.abort()
    }
  }, [load])

  return { unread, error, refresh: load }
}
