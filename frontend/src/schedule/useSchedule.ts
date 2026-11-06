// State of the two schedule readings (J-F05): the academy's weekly schedule
// (API-090, with filters) and «my schedule» (API-091). One request per filter
// set; in-flight requests are aborted and stale answers dropped; `reload`
// re-reads the same filters. Disabled readings (no permission, hidden tab)
// never call the server.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAcademySchedule, getMySchedule } from '../api/schedule'
import type { AcademySchedule, MySchedule } from '../api/schedule'

interface FetchState<T> {
  key: string
  data: T | null
  error: unknown
}

type Loader<T, F> = (filters: F, signal: AbortSignal) => Promise<T>

function useReading<T, F extends object>(load: Loader<T, F>, initialFilters: F, enabled: boolean) {
  const [filters, setFiltersState] = useState<F>(initialFilters)
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<FetchState<T>>({ key: '', data: null, error: null })
  const requestKey = JSON.stringify([filters, tick])
  const loading = enabled && state.key !== requestKey

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    load(filters, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ key: requestKey, data, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((current) => ({ ...current, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [enabled, load, filters, requestKey])

  const setFilters = useCallback((patch: Partial<F>) => setFiltersState((current) => ({ ...current, ...patch })), [])
  const reload = useCallback(() => setTick((value) => value + 1), [])

  return useMemo(
    () => ({ filters, setFilters, data: state.data, error: state.error, loading, reload }),
    [filters, setFilters, state.data, state.error, loading, reload],
  )
}

export interface AcademyScheduleFilters {
  /** `YYYY-MM-DD`; undefined = today in the academy's time zone. */
  on: string | undefined
  classId: string | undefined
  teacherUserId: string | undefined
  roomId: string | undefined
}

export const DEFAULT_ACADEMY_FILTERS: AcademyScheduleFilters = { on: undefined, classId: undefined, teacherUserId: undefined, roomId: undefined }

const loadAcademy: Loader<AcademySchedule, AcademyScheduleFilters> = (filters, signal) => getAcademySchedule(filters, signal)

export function useAcademySchedule(enabled: boolean, initialFilters: AcademyScheduleFilters = DEFAULT_ACADEMY_FILTERS) {
  return useReading(loadAcademy, initialFilters, enabled)
}

export interface MyScheduleFilters {
  on: string | undefined
}

export const DEFAULT_MY_FILTERS: MyScheduleFilters = { on: undefined }

const loadMine: Loader<MySchedule, MyScheduleFilters> = (filters, signal) => getMySchedule(filters, signal)

export function useMySchedule(enabled: boolean, initialFilters: MyScheduleFilters = DEFAULT_MY_FILTERS) {
  return useReading(loadMine, initialFilters, enabled)
}
