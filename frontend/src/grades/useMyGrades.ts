// State of the «my grades» page (J-F50): API-129 has no pagination, so this is
// one request per filter change (and per reload), aborted when the filters
// change before it answers; a stale answer is dropped. A failed read keeps the
// cards of the last answer behind the error, as the keyset lists do.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listMyGrades } from '../api/myGrades'
import type { MyGradeItem } from '../api/myGrades'
import { DEFAULT_MY_GRADES_FILTERS, myGradesQuery } from './myGrades.view'
import type { MyGradesFilters } from './myGrades.view'

interface MyGradesState {
  key: string
  items: MyGradeItem[]
  error: unknown
}

export function useMyGrades(initialFilters: MyGradesFilters = DEFAULT_MY_GRADES_FILTERS) {
  const [filters, setFiltersState] = useState<MyGradesFilters>(initialFilters)
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState<MyGradesState>({ key: '', items: [], error: null })
  const requestKey = JSON.stringify([filters, reloadTick])
  const loading = state.key !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    listMyGrades(myGradesQuery(filters), controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return
        setState({ key: requestKey, items: list.items, error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState((current) => ({ ...current, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [filters, requestKey])

  const setFilters = useCallback((patch: Partial<MyGradesFilters>) => setFiltersState((current) => ({ ...current, ...patch })), [])
  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  return useMemo(
    () => ({ filters, setFilters, items: state.items, error: state.error, loading, reload }),
    [filters, setFilters, state.items, state.error, loading, reload],
  )
}
