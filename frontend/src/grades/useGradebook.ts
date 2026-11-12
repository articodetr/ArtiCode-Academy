// The gradebook of one class (API-126) for the «grades» tab of the class drawer
// (J-F49), on the pattern of exams/useExamResults.ts: one request per class,
// refresh key and reload, aborted on change or unmount; a failure keeps the
// last gradebook behind the error. A write's answer — the gradebook after a
// finalization or a withdrawal (API-127/API-128) — replaces it without another
// read, so the screen always shows what the server answered (no optimistic
// rows); a read still running at that moment would bring an older state, so it
// is dropped. `refreshKey` follows the class as the drawer holds it (its
// status, its active enrollments, its server version): when the drawer's class
// changes, the gradebook is read again.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getGradebook } from '../api/gradebook'
import type { Gradebook } from '../api/gradebook'

interface GradebookState {
  /** The request the state answers (`classId:refreshKey:tick`). */
  key: string
  gradebook: Gradebook | null
  error: unknown
}

export interface GradebookView {
  gradebook: Gradebook | null
  /** The failure of the last read, or null (a write's answer clears it). */
  error: unknown
  loading: boolean
  reload: () => void
  /** Shows a write's answer (API-127/API-128) as the gradebook. */
  replace: (gradebook: Gradebook) => void
}

export function useGradebook(classId: string, refreshKey: string): GradebookView {
  const [tick, setTick] = useState(0)
  const requestKey = `${classId}:${refreshKey}:${tick}`
  const [state, setState] = useState<GradebookState>({ key: '', gradebook: null, error: null })
  // The read in flight and the request it answers, so a write's answer can drop it.
  const inFlight = useRef<{ key: string; controller: AbortController } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    inFlight.current = { key: requestKey, controller }
    getGradebook(classId, controller.signal)
      .then((gradebook) => {
        if (!controller.signal.aborted) setState({ key: requestKey, gradebook, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [classId, requestKey])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const replace = useCallback((gradebook: Gradebook) => {
    const current = inFlight.current
    current?.controller.abort()
    setState((previous) => ({ key: current?.key ?? previous.key, gradebook, error: null }))
  }, [])

  const answered = state.key === requestKey
  return { gradebook: state.gradebook, error: answered ? state.error : null, loading: !answered, reload, replace }
}
