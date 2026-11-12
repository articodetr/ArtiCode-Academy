// The dashboard's overview (API-164 — J-F53, MOD-13-T06): read once on mount
// and on reload, by a component the dashboard mounts only for a holder of a
// report key — anyone else never sends the request (the server would answer
// 403 permission_denied). A failure keeps the last answer behind the error.
import { useCallback, useEffect, useState } from 'react'
import { getReportsOverview } from '../api/reports'
import type { ReportsOverview } from '../api/reports'

export interface ReportsOverviewState {
  overview: ReportsOverview | null
  loading: boolean
  error: unknown
  reload: () => void
}

export function useReportsOverview(): ReportsOverviewState {
  const [overview, setOverview] = useState<ReportsOverview | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [requestKey, setRequestKey] = useState(0)
  const [settledKey, setSettledKey] = useState(-1)

  useEffect(() => {
    const controller = new AbortController()
    getReportsOverview(controller.signal)
      .then(
        (result) => {
          if (controller.signal.aborted) return
          setOverview(result)
          setError(null)
        },
        (caught: unknown) => {
          if (!controller.signal.aborted) setError(caught)
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setSettledKey(requestKey)
      })
    return () => controller.abort()
  }, [requestKey])

  const reload = useCallback(() => setRequestKey((key) => key + 1), [])

  return { overview, loading: settledKey !== requestKey, error, reload }
}
