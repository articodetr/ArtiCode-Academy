// State of the «my certificates» page (J-F51): API-135 has no pagination — a
// learner holds few certificates — so this is one request per reload, aborted
// when the page leaves; the student filter of the page narrows the items it
// already holds.
import { useCallback, useEffect, useState } from 'react'
import { listMyCertificates } from '../api/myCertificates'
import type { MyCertificateItem } from '../api/myCertificates'

interface MyCertificatesState {
  key: string
  items: MyCertificateItem[]
  error: unknown
}

export function useMyCertificates() {
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState<MyCertificatesState>({ key: '', items: [], error: null })
  const requestKey = String(reloadTick)
  const loading = state.key !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    listMyCertificates({}, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setState({ key: requestKey, items: list.items, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((current) => ({ ...current, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [requestKey])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  return { items: state.items, error: state.error, loading, reload }
}
