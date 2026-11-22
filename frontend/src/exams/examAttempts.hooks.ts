// The hooks of the «attempts» tab of the exam drawer (MOD-09 phase 2 —
// OEX-T07). Its two reads, on the pattern of assignments/useSubmissionRoster.ts
// and useSubmission.ts: one request per target and reload, aborted on change or
// unmount; a failed reload keeps the last answer on screen under the error.
// Nothing is polled and nothing is edited locally — after a regrade the tab
// reads the roster again. And the focus hand-back of its panel and its dialog.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getExamAttempt, getExamAttempts } from '../api/examAttempts'
import type { ExamAttemptDetail, ExamAttempts } from '../api/examAttempts'

/**
 * Hands the keyboard focus back to the control that opened a panel or a dialog
 * once it has left. The tab unmounts both when they close, and antd restores
 * the focus only for one closed with `open={false}`; without this a keyboard
 * user would land at the top of the page. Returns `remember(control)` for the
 * click that opens; a control that is no longer in the document (its row left
 * with a reload) is let go.
 */
export function useFocusReturn(open: boolean): (opener: HTMLElement | null) => void {
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open || !opener.current) return
    const control = opener.current
    opener.current = null
    if (control.isConnected) control.focus({ preventScroll: true })
  }, [open])

  return useCallback((control: HTMLElement | null) => {
    opener.current = control
  }, [])
}

interface RosterState {
  /** The request the state answers (`examId:examVersion:tick`). */
  key: string
  attempts: ExamAttempts | null
  error: unknown
}

/**
 * The roster of attempts of one exam (API-274). `examVersion` is the exam's
 * `updatedAt` as the drawer holds it: when the exam changes there — published
 * (which closes every attempt still open), its window moved, back to draft —
 * what was read is older than the exam on screen, so the roster is read again.
 * A regrade and a saved results sheet do not move it; the tab reloads itself
 * after the first, and «refresh» serves the second.
 */
export function useExamAttempts(examId: string, examVersion: string) {
  const [tick, setTick] = useState(0)
  const requestKey = `${examId}:${examVersion}:${tick}`
  const [state, setState] = useState<RosterState>({ key: '', attempts: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    getExamAttempts(examId, controller.signal)
      .then((attempts) => {
        if (!controller.signal.aborted) setState({ key: requestKey, attempts, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [examId, requestKey])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const answered = state.key === requestKey

  return { attempts: state.attempts, error: answered ? state.error : null, loading: !answered, reload }
}

interface DetailState {
  /** The request the state answers (`attemptId:tick`). */
  key: string
  attempt: ExamAttemptDetail | null
  error: unknown
}

/** One attempt with the key and the student's answers (API-275). */
export function useExamAttempt(attemptId: string) {
  const [tick, setTick] = useState(0)
  const requestKey = `${attemptId}:${tick}`
  const [state, setState] = useState<DetailState>({ key: '', attempt: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    getExamAttempt(attemptId, controller.signal)
      .then((attempt) => {
        if (!controller.signal.aborted) setState({ key: requestKey, attempt, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [attemptId, requestKey])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const answered = state.key === requestKey

  return { attempt: state.attempt, error: answered ? state.error : null, loading: !answered, reload }
}
