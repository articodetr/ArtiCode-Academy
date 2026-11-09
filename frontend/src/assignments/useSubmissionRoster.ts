// The submission roster of one assignment (API-108) for the submissions tab
// of the assignment drawer (J-F41): one request per assignment and reload,
// aborted on change or unmount. The roster is never edited locally: after a
// review the tab reloads it, because the review's answer (API-111) carries the
// reviewed attempt only — not the row's `lastGradedScore` nor the other rows.
import { useCallback, useEffect, useState } from 'react'
import { getSubmissionRoster } from '../api/submissions'
import type { SubmissionRoster } from '../api/submissions'

interface RosterState {
  /** The request the state answers (`assignmentId:tick`). */
  key: string
  roster: SubmissionRoster | null
  error: unknown
}

export function useSubmissionRoster(assignmentId: string) {
  const [tick, setTick] = useState(0)
  const requestKey = `${assignmentId}:${tick}`
  const [state, setState] = useState<RosterState>({ key: '', roster: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    getSubmissionRoster(assignmentId, controller.signal)
      .then((roster) => {
        if (!controller.signal.aborted) setState({ key: requestKey, roster, error: null })
      })
      .catch((error: unknown) => {
        // A failed reload keeps the last roster on screen under the error.
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [assignmentId, requestKey])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const answered = state.key === requestKey

  return { roster: state.roster, error: answered ? state.error : null, loading: !answered, reload }
}
