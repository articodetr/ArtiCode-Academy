// The unread count of the header bell (J-F54 — MOD-12-T07): GET
// /api/me/notifications/unread-count (API-168) — D-R86: polled every 60 s while
// the page is visible, never through a socket. One shared reading for every
// reader of the signed-in layout (the pattern of useAcademy): the first reader
// asks at once and starts the timer; the timer stops while
// `document.visibilityState` is not 'visible' and the count is asked again the
// moment the page shows again. Any mark-read — on the page or in the bell's
// panel — calls refreshUnreadCount(), so the count follows at once instead of
// at the next poll. A failed read keeps the last count (no banner in the
// header). The reading is dropped when its last reader unmounts (sign-out,
// leaving the layout, every test's cleanup), so the next mount reads afresh.
import { useSyncExternalStore } from 'react'
import { getUnreadCount } from '../api/myNotifications'

/** D-R86: how often the bell asks while the page is visible. */
export const UNREAD_POLL_MS = 60_000

export interface UnreadReading {
  /** null until the first answer arrives. */
  unread: number | null
  /** The last failure, or null; the last count stays behind it. */
  error: unknown
}

const INITIAL: UnreadReading = { unread: null, error: null }

let reading: UnreadReading = INITIAL
let inFlight: AbortController | null = null
let timer: ReturnType<typeof setInterval> | null = null
const readers = new Set<() => void>()

function publish(next: UnreadReading) {
  reading = next
  for (const reader of readers) reader()
}

function pageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

/** Asks for the count (again); an answer still on its way is abandoned — the newest request wins. */
function load() {
  inFlight?.abort()
  const controller = new AbortController()
  inFlight = controller
  getUnreadCount(controller.signal).then(
    ({ unread }) => {
      if (controller.signal.aborted) return
      inFlight = null
      publish({ unread, error: null })
    },
    (error: unknown) => {
      if (controller.signal.aborted) return
      inFlight = null
      publish({ ...reading, error })
    },
  )
}

function stopPolling() {
  if (timer !== null) clearInterval(timer)
  timer = null
}

/** Reads now and every UNREAD_POLL_MS from now on. */
function startPolling() {
  stopPolling()
  load()
  timer = setInterval(load, UNREAD_POLL_MS)
}

function onVisibilityChange() {
  if (pageVisible()) startPolling()
  else stopPolling()
}

function subscribe(reader: () => void): () => void {
  readers.add(reader)
  if (readers.size === 1) {
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (pageVisible()) startPolling()
  }
  return () => {
    readers.delete(reader)
    if (readers.size > 0) return
    document.removeEventListener('visibilitychange', onVisibilityChange)
    stopPolling()
    inFlight?.abort()
    inFlight = null
    reading = INITIAL
  }
}

const snapshot = () => reading

/**
 * After a mark-read (API-169/170): ask for the count now. Nothing happens while no bell is on screen
 * (a page rendered outside the layout) or while the page is hidden (the count is asked when it shows).
 */
export function refreshUnreadCount(): void {
  if (readers.size === 0 || !pageVisible()) return
  load()
}

/** The shared reading; mounting the first reader starts the polling. */
export function useUnreadCount(): UnreadReading {
  return useSyncExternalStore(subscribe, snapshot)
}
