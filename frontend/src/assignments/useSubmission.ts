// One submission (API-110) for the review panel (J-F41): one request per
// submission and reload, aborted on change or unmount. A review's answer
// (API-111) replaces it without another read, so the panel always shows what
// the server answered. Every new submission, loaded or reviewed, bumps
// `version`: the grading form is keyed by it, so each form session starts
// from the server's state (KI-049).
import { useCallback, useEffect, useState } from 'react'
import { getSubmission } from '../api/submissions'
import type { Submission } from '../api/submissions'

interface SubmissionState {
  /** The request the state answers (`submissionId:tick`). */
  key: string
  submission: Submission | null
  error: unknown
  version: number
}

export function useSubmission(submissionId: string) {
  const [tick, setTick] = useState(0)
  const requestKey = `${submissionId}:${tick}`
  const [state, setState] = useState<SubmissionState>({ key: '', submission: null, error: null, version: 0 })

  useEffect(() => {
    const controller = new AbortController()
    getSubmission(submissionId, controller.signal)
      .then((submission) => {
        if (!controller.signal.aborted) setState((previous) => ({ key: requestKey, submission, error: null, version: previous.version + 1 }))
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [submissionId, requestKey])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const replace = useCallback((submission: Submission) => setState((previous) => ({ ...previous, submission, error: null, version: previous.version + 1 })), [])
  const answered = state.key === requestKey

  return { submission: state.submission, error: answered ? state.error : null, loading: !answered, version: state.version, reload, replace }
}
