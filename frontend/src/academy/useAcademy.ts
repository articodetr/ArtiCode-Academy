// The academy row of GET /api/academy (API-035), read once and shared by every
// reader of the signed-in layout: the header's name and logo (J-F13,
// MOD-02-T04), the general settings tab (MOD-02/MOD-14) and the weekly
// calendar's time zone and week (J-F08) — one request between them while any
// of them is mounted. The row is replaced only by what the server returned for
// a write (no optimism), so a saved PATCH (API-036) shows in the header at
// once. It is dropped when its last reader unmounts (sign-out, leaving the
// layout, every test's cleanup), so the next mount reads it afresh; a change
// made in another tab shows after the page is reloaded.
import { useMemo, useSyncExternalStore } from 'react'
import { getAcademy } from '../api/academy'
import type { Academy } from '../api/academy'

export interface AcademyReading {
  academy: Academy | null
  /** True until the first answer arrives, and again while a reload runs. */
  loading: boolean
  /** The last load failure, or null; the last academy stays on screen behind it. */
  error: unknown
}

const INITIAL: AcademyReading = { academy: null, loading: true, error: null }

let reading: AcademyReading = INITIAL
let inFlight: AbortController | null = null
const readers = new Set<() => void>()

function publish(next: AcademyReading) {
  reading = next
  for (const reader of readers) reader()
}

/** Reads the academy (again); a read still in flight is abandoned. */
function load() {
  inFlight?.abort()
  const controller = new AbortController()
  inFlight = controller
  if (!reading.loading) publish({ ...reading, loading: true })
  getAcademy(controller.signal).then(
    (academy) => {
      if (controller.signal.aborted) return
      inFlight = null
      publish({ academy, loading: false, error: null })
    },
    (error: unknown) => {
      if (controller.signal.aborted) return
      inFlight = null
      // Keep what was on screen behind the error message.
      publish({ ...reading, loading: false, error })
    },
  )
}

/** After a successful PATCH: every reader shows the academy as the response returned it. */
function replace(academy: Academy) {
  // The write's answer is newer than any read still in flight.
  inFlight?.abort()
  inFlight = null
  publish({ academy, loading: false, error: null })
}

function subscribe(reader: () => void): () => void {
  readers.add(reader)
  // The first reader starts the one request; the others share its answer.
  if (reading === INITIAL && inFlight === null) load()
  return () => {
    readers.delete(reader)
    if (readers.size > 0) return
    inFlight?.abort()
    inFlight = null
    reading = INITIAL
  }
}

const snapshot = () => reading

export function useAcademy() {
  const current = useSyncExternalStore(subscribe, snapshot)
  return useMemo(() => ({ ...current, reload: load, replace }), [current])
}
