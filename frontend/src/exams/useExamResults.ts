// The results sheet of one exam (API-119) for the «results» tab of the exam
// drawer (J-F45), on the pattern of attendance/useAttendanceSheet.ts: one
// request per exam and reload, aborted on change or unmount. A saved sheet —
// the PUT's answer (API-120) — replaces it without another read, so the screen
// always shows what the server answered (no optimistic rows). Every new sheet,
// loaded or saved, bumps `version`: the editor is keyed by it, so each edit
// session starts from the server's state (KI-049).
// Since MOD-09 phase 2: `refresh()` reads the sheet again WITHOUT starting a
// new edit session — after `result_from_attempt` the rows of the students who
// started an attempt must lock while the other unsaved rows stay as typed. It
// bumps `revision` only, which counts every sheet the server answered (read,
// saved or refreshed): what follows the newest fact keys on it.
import { useCallback, useEffect, useState } from 'react'
import { getExamResults } from '../api/examResults'
import type { ExamResultsSheet } from '../api/examResults'

interface SheetState {
  /** The request the state answers (`examId:tick`). */
  key: string
  sheet: ExamResultsSheet | null
  error: unknown
  version: number
  revision: number
}

interface SheetRequest {
  tick: number
  /** True for a read that keeps the edit session (`refresh()`); false for one that starts a new one (the first read, `reload()`). */
  sameSession: boolean
}

export function useExamResults(examId: string) {
  const [request, setRequest] = useState<SheetRequest>({ tick: 0, sameSession: false })
  const { sameSession } = request
  const requestKey = `${examId}:${request.tick}`
  const [state, setState] = useState<SheetState>({ key: '', sheet: null, error: null, version: 0, revision: 0 })

  useEffect(() => {
    const controller = new AbortController()
    getExamResults(examId, controller.signal)
      .then((sheet) => {
        if (controller.signal.aborted) return
        setState((previous) => ({ key: requestKey, sheet, error: null, version: sameSession ? previous.version : previous.version + 1, revision: previous.revision + 1 }))
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [examId, requestKey, sameSession])

  const reload = useCallback(() => setRequest((previous) => ({ tick: previous.tick + 1, sameSession: false })), [])
  const refresh = useCallback(() => setRequest((previous) => ({ tick: previous.tick + 1, sameSession: true })), [])
  const replace = useCallback(
    (sheet: ExamResultsSheet) => setState((previous) => ({ ...previous, sheet, error: null, version: previous.version + 1, revision: previous.revision + 1 })),
    [],
  )
  const answered = state.key === requestKey

  return { sheet: state.sheet, error: answered ? state.error : null, loading: !answered, version: state.version, revision: state.revision, reload, refresh, replace }
}
