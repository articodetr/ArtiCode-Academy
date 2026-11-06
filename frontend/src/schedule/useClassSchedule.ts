// State of one class's weekly schedule (J-F07): GET /api/classes/:id/schedule
// (API-088) on mount and on every reload, replaced only by what the server
// returned for a write (no optimism) — the pattern of academy/useAcademy.ts.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getClassSchedule } from '../api/schedule'
import type { ClassSchedule } from '../api/schedule'

interface ScheduleState {
  /** Identifies the request this state answers; a different key on screen means loading. */
  key: string
  schedule: ClassSchedule | null
  error: unknown
}

const INITIAL: ScheduleState = { key: '', schedule: null, error: null }

export function useClassSchedule(classId: string) {
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<ScheduleState>(INITIAL)
  const key = `${classId}#${tick}`
  const loading = state.key !== key

  useEffect(() => {
    const controller = new AbortController()
    getClassSchedule(classId, controller.signal)
      .then((schedule) => {
        if (controller.signal.aborted) return
        setState({ key, schedule, error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        // Keep what was on screen behind the error message, unless it belongs to another class.
        setState((current) => ({ key, schedule: current.schedule?.classId === classId ? current.schedule : null, error }))
      })
    return () => controller.abort()
  }, [classId, key])

  const reload = useCallback(() => setTick((value) => value + 1), [])

  /** After a successful PUT: the screen shows the schedule as the response returned it. */
  const replace = useCallback((schedule: ClassSchedule) => {
    setState((current) => ({ ...current, schedule, error: null }))
  }, [])

  return useMemo(() => ({ schedule: state.schedule, loading, error: state.error, reload, replace }), [state, loading, reload, replace])
}
