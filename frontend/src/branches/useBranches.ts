// The branch list of the settings screen (API-080), on the pattern of
// courses/useLevels.ts: loading is derived from the request key, a failure
// keeps the last list behind the error, and every successful write re-reads
// the list from the server — a promotion makes another branch step down and
// the server orders the list (main first, then by code), so a single returned
// row never tells the whole story.
import { useCallback, useEffect, useState } from 'react'
import { listBranches } from '../api/branches'
import type { Branch } from '../api/branches'

export interface BranchesState {
  branches: Branch[]
  loading: boolean
  /** The last load failure, or null. */
  error: unknown
  reload: () => void
}

export function useBranches(): BranchesState {
  const [branches, setBranches] = useState<Branch[]>([])
  const [error, setError] = useState<unknown>(null)
  const [requestKey, setRequestKey] = useState(0)
  const [settledKey, setSettledKey] = useState(-1)

  useEffect(() => {
    const controller = new AbortController()
    listBranches(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setBranches(result.items)
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

  return { branches, loading: settledKey !== requestKey, error, reload }
}
