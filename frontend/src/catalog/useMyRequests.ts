// «My requests» (API-222): one request (no pagination — a student has few),
// only when `enabled` (a viewer without the `student` role asks nothing).
// `replace()` puts the server's answer to a cancellation (API-223) in place.
import { useCallback, useEffect, useState } from 'react'
import { listMyEnrollmentRequests } from '../api/catalog'
import type { MyEnrollmentRequest } from '../api/catalog'

interface RequestsState {
  key: string
  items: MyEnrollmentRequest[]
  error: unknown
}

export function useMyRequests(enabled: boolean) {
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState<RequestsState>({ key: '', items: [], error: null })
  const requestKey = enabled ? String(reloadTick) : 'off'

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    listMyEnrollmentRequests(controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setState({ key: requestKey, items: list.items, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((current) => ({ ...current, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [enabled, requestKey])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])
  const replace = useCallback((item: MyEnrollmentRequest) => {
    setState((current) => ({ ...current, items: current.items.map((row) => (row.id === item.id ? item : row)) }))
  }, [])

  return { items: enabled ? state.items : [], error: enabled ? state.error : null, loading: enabled && state.key !== requestKey, reload, replace }
}
