// The attendance sheet of one lesson (API-099) for the attendance tab of the
// lesson drawer (J-F10): one request per lesson and reload, aborted on change
// or unmount. A saved sheet — the PUT's answer (API-100) — replaces it without
// another read, so the screen always shows what the server answered (no
// optimistic rows). Every new sheet, loaded or saved, bumps `version`: the
// editor is keyed by it, so each edit session starts from the server's state
// (KI-049).
import { useCallback, useEffect, useState } from 'react'
import { getAttendanceSheet } from '../api/attendance'
import type { AttendanceSheet } from '../api/attendance'

interface SheetState {
  /** The request the state answers (`lessonId:tick`). */
  key: string
  sheet: AttendanceSheet | null
  error: unknown
  version: number
}

export function useAttendanceSheet(lessonId: string) {
  const [tick, setTick] = useState(0)
  const requestKey = `${lessonId}:${tick}`
  const [state, setState] = useState<SheetState>({ key: '', sheet: null, error: null, version: 0 })

  useEffect(() => {
    const controller = new AbortController()
    getAttendanceSheet(lessonId, controller.signal)
      .then((sheet) => {
        if (!controller.signal.aborted) setState((previous) => ({ key: requestKey, sheet, error: null, version: previous.version + 1 }))
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [lessonId, requestKey])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const replace = useCallback((sheet: AttendanceSheet) => setState((previous) => ({ ...previous, sheet, error: null, version: previous.version + 1 })), [])
  const answered = state.key === requestKey

  return { sheet: state.sheet, error: answered ? state.error : null, loading: !answered, version: state.version, reload, replace }
}
