// The grade scheme list of the settings screen (API-122), on the pattern of
// branches/useBranches.ts: loading is derived from the request key, a failure
// keeps the last list behind the error, and every write is followed by a
// re-read from the server — a promotion makes another scheme step down and the
// server orders the list (the default first, then by creation), so a single
// returned row never tells the whole story.
import { useCallback, useEffect, useState } from 'react'
import { listGradeSchemes } from '../api/gradeSchemes'
import type { GradeScheme } from '../api/gradeSchemes'

export interface GradeSchemesState {
  schemes: GradeScheme[]
  loading: boolean
  /** The last load failure, or null. */
  error: unknown
  reload: () => void
}

export function useGradeSchemes(): GradeSchemesState {
  const [schemes, setSchemes] = useState<GradeScheme[]>([])
  const [error, setError] = useState<unknown>(null)
  const [requestKey, setRequestKey] = useState(0)
  const [settledKey, setSettledKey] = useState(-1)

  useEffect(() => {
    const controller = new AbortController()
    listGradeSchemes(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setSchemes(result.items)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught)
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettledKey(requestKey)
      })
    return () => controller.abort()
  }, [requestKey])

  const reload = useCallback(() => setRequestKey((key) => key + 1), [])

  return { schemes, loading: settledKey !== requestKey, error, reload }
}
