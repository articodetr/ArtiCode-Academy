// The branches for the branch filter of the academy schedule (J-F08): API-080,
// every signed-in user (inactive branches for `branches.manage` only), read
// once while enabled. A failure reads as "no branches", so the filter simply
// stays hidden — the schedule itself does not depend on it.
import { useEffect, useState } from 'react'
import { listTimetableBranches } from '../api/timetable'
import type { TimetableBranchOption } from '../api/timetable'

/** `branchId=none` = the rooms of the academy's own site (API-090). */
export const SITE_BRANCH = 'none'

export interface BranchState {
  loaded: boolean
  items: TimetableBranchOption[]
}

export function useTimetableBranches(enabled: boolean): BranchState {
  const [state, setState] = useState<BranchState>({ loaded: false, items: [] })
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    listTimetableBranches(controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setState({ loaded: true, items: list.items })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ loaded: true, items: [] })
      })
    return () => controller.abort()
  }, [enabled])
  return state
}
