// Loads the report the page shows (MOD-13-T06 — J-F53): one request per report
// and set of parameters (the request path is the identity — a filter the report
// does not send never reloads it), the one in flight aborted when they change,
// a stale answer dropped. The last answer stays on screen while the next one
// loads or behind a failure; an answer is only ever returned for the report it
// answers (LoadedReport carries its key), and a failure only for the request
// it failed — so neither shows under another report's title. Read-only: nothing
// is written, and the server records no audit event (D-R73).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { reportRequest } from './reports.catalog'
import type { LoadedReport, ReportFilters, ReportKey } from './reports.catalog'

export interface ReportState {
  report: LoadedReport | null
  loading: boolean
  /** The failure of the current request (the last answer, if any, stays in `report`), or null. */
  error: unknown
  /** The path of the shown request, or null while `enabled` is false. */
  path: string | null
  reload: () => void
}

/** `enabled: false` (a filter the server would refuse): nothing is sent and the last answer stays. */
export function useReport(key: ReportKey, filters: ReportFilters, enabled: boolean): ReportState {
  const request = reportRequest(key, filters)
  const path = enabled ? request.path : null
  const [loaded, setLoaded] = useState<LoadedReport | null>(null)
  const [failure, setFailure] = useState<{ path: string; error: unknown } | null>(null)
  const [tick, setTick] = useState(0)
  const [settled, setSettled] = useState<string | null>(null)
  const requestId = path === null ? null : `${path}#${tick}`

  // The request of the latest render; layout effects run before the effect below, so it sends the current one.
  const latest = useRef(request)
  useLayoutEffect(() => {
    latest.current = request
  })

  useEffect(() => {
    if (requestId === null) return
    const current = latest.current
    const controller = new AbortController()
    current
      .load(controller.signal)
      .then(
        (result) => {
          if (controller.signal.aborted) return
          setLoaded(result)
          setFailure(null)
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setFailure({ path: current.path, error })
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setSettled(requestId)
      })
    return () => controller.abort()
  }, [requestId])

  const reload = useCallback(() => setTick((value) => value + 1), [])

  return {
    report: loaded && loaded.key === key ? loaded : null,
    loading: requestId !== null && settled !== requestId,
    error: failure && failure.path === path ? failure.error : null,
    path,
    reload,
  }
}
