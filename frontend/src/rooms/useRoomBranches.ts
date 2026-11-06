// The branch list the rooms screen needs (API-080) for its branch filter and
// the branch picker of the room form: every signed-in user sees the active
// branches, holders of `branches.manage` also the inactive ones. Same shape as
// useRooms; a failure leaves an empty list (the filter and picker then offer
// the academy's own site only) and the room list still works.
import { useCallback, useEffect, useState } from 'react'
import { listBranches } from '../api/branches'
import type { Branch } from '../api/branches'

export interface RoomBranchesState {
  branches: Branch[]
  loading: boolean
  /** The last load failure, or null. */
  error: unknown
  reload: () => void
}

export function useRoomBranches(): RoomBranchesState {
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
