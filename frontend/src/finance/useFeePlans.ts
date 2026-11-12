// The fee plans (API-140), on the pattern of grades/useGradeSchemes.ts: loading
// is derived from the request key, a failure keeps the last list behind the
// error, and every write is followed by a re-read from the server (the counts
// and the order are the server's). `enabled: false` reads nothing — a caller
// who holds neither read key (the server would answer 403) gets an empty list.
import { useCallback, useEffect, useState } from 'react'
import { listFeePlans } from '../api/feePlans'
import type { FeePlan } from '../api/feePlans'

export interface FeePlansState {
  plans: FeePlan[]
  loading: boolean
  /** The last load failure, or null. */
  error: unknown
  reload: () => void
}

export function useFeePlans(enabled = true): FeePlansState {
  const [plans, setPlans] = useState<FeePlan[]>([])
  const [error, setError] = useState<unknown>(null)
  const [requestKey, setRequestKey] = useState(0)
  const [settledKey, setSettledKey] = useState(-1)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    listFeePlans({}, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setPlans(result.items)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught)
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettledKey(requestKey)
      })
    return () => controller.abort()
  }, [enabled, requestKey])

  const reload = useCallback(() => setRequestKey((key) => key + 1), [])

  return { plans: enabled ? plans : [], loading: enabled && settledKey !== requestKey, error: enabled ? error : null, reload }
}
