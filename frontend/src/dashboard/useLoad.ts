import { useEffect, useState } from 'react'

export interface Loaded<T> {
  /** The last answer; null before it arrives, after a failure, or when the read is not allowed. */
  data: T | null
  loading: boolean
  error: unknown
}

/**
 * One read for a dashboard panel: runs `load` when `enabled` (the caller holds the key the server checks) and
 * again when `key` changes; the read in flight is aborted on a new key and on unmount. A disabled read
 * answers `{ data: null, loading: false }` without a request.
 */
export function useLoad<T>(key: string, enabled: boolean, load: (signal: AbortSignal) => Promise<T>): Loaded<T> {
  const [state, setState] = useState<{ key: string | null; value: Loaded<T> }>({ key: null, value: { data: null, loading: enabled, error: null } })

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    load(controller.signal).then(
      (data) => setState({ key, value: { data, loading: false, error: null } }),
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ key, value: { data: null, loading: false, error } })
      },
    )
    return () => controller.abort()
    // `load` is a fresh closure on every render; the key names what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  if (!enabled) return { data: null, loading: false, error: null }
  if (state.key !== key) return { data: null, loading: true, error: null }
  return state.value
}
