// The level list of the courses screen (API-037): the level filter and picker
// (T05) and the levels tab (T06) share it, so a level created, renamed,
// reordered or deleted in the tab shows at once in the filter. Loading is
// derived from the request key; a failure leaves the last list in place
// (the filter still works without it, the server validates any level id).
import { useCallback, useEffect, useState } from 'react'
import { listLevels } from '../api/levels'
import type { Level } from '../api/levels'

export interface LevelsState {
  levels: Level[]
  loading: boolean
  /** The last load failure, or null. */
  error: unknown
  reload: () => void
  /** Replace the list with what the server returned after a write. */
  setLevels: (levels: Level[]) => void
}

export function useLevels(): LevelsState {
  const [levels, setLevels] = useState<Level[]>([])
  const [error, setError] = useState<unknown>(null)
  const [requestKey, setRequestKey] = useState(0)
  const [settledKey, setSettledKey] = useState(-1)

  useEffect(() => {
    const controller = new AbortController()
    listLevels(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setLevels(result.items)
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

  return { levels, loading: settledKey !== requestKey, error, reload, setLevels }
}
