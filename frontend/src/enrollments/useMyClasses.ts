// State of the «my classes» page (J-F04): API-060 has no pagination, so this
// is one request per status filter (and per reload), aborted when the filter
// changes before it answers.
import { useCallback, useEffect, useState } from 'react'
import { listMyClasses } from '../api/enrollments'
import type { EnrollmentStatus, MyClassItem } from '../api/enrollments'

interface MyClassesState {
  key: string
  items: MyClassItem[]
  error: unknown
}

export function useMyClasses() {
  const [status, setStatus] = useState<EnrollmentStatus | undefined>(undefined)
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState<MyClassesState>({ key: '', items: [], error: null })
  const requestKey = `${status ?? ''}:${reloadTick}`
  const loading = state.key !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    listMyClasses({ status }, controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return
        setState({ key: requestKey, items: list.items, error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState((current) => ({ ...current, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [status, requestKey])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  return { status, setStatus, items: state.items, error: state.error, loading, reload }
}
