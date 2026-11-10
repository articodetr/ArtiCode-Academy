// The results sheet of one exam (API-119) for the «results» tab of the exam
// drawer (J-F45), on the pattern of attendance/useAttendanceSheet.ts: one
// request per exam and reload, aborted on change or unmount. A saved sheet —
// the PUT's answer (API-120) — replaces it without another read, so the screen
// always shows what the server answered (no optimistic rows). Every new sheet,
// loaded or saved, bumps `version`: the editor is keyed by it, so each edit
// session starts from the server's state (KI-049).
import { useCallback, useEffect, useState } from 'react'
import { getExamResults } from '../api/examResults'
import type { ExamResultsSheet } from '../api/examResults'

interface SheetState {
  /** The request the state answers (`examId:tick`). */
  key: string
  sheet: ExamResultsSheet | null
  error: unknown
  version: number
}

export function useExamResults(examId: string) {
  const [tick, setTick] = useState(0)
  const requestKey = `${examId}:${tick}`
  const [state, setState] = useState<SheetState>({ key: '', sheet: null, error: null, version: 0 })

  useEffect(() => {
    const controller = new AbortController()
    getExamResults(examId, controller.signal)
      .then((sheet) => {
        if (!controller.signal.aborted) setState((previous) => ({ key: requestKey, sheet, error: null, version: previous.version + 1 }))
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [examId, requestKey])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const replace = useCallback((sheet: ExamResultsSheet) => setState((previous) => ({ ...previous, sheet, error: null, version: previous.version + 1 })), [])
  const answered = state.key === requestKey

  return { sheet: state.sheet, error: answered ? state.error : null, loading: !answered, version: state.version, reload, replace }
}
