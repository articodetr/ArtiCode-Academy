import { useCallback, useEffect, useState } from 'react'

export interface Loaded<T> {
  /** The last answer; null before it arrives, after a failure, or when the read is not allowed. */
  data: T | null
  loading: boolean
  error: unknown
}

/** A `Loaded` that can ask again — a panel's «try again» after a failure. */
export interface Reloadable<T> extends Loaded<T> {
  /** Runs the read again under the same key; does nothing while the read is not allowed. */
  retry: () => void
}

/**
 * One read for a dashboard panel: runs `load` when `enabled` (the caller holds the key the server checks) and
 * again when `key` changes or `retry()` is called; the read in flight is aborted on a new key, a retry and on
 * unmount. A disabled read answers `{ data: null, loading: false }` without a request.
 */
export function useLoad<T>(key: string, enabled: boolean, load: (signal: AbortSignal) => Promise<T>): Reloadable<T> {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string | null; value: Loaded<T> }>({ key: null, value: { data: null, loading: enabled, error: null } })
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  // The attempt is part of what is read: a retry shows the loading state again until its answer arrives.
  const readKey = `${attempt}:${key}`

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    load(controller.signal).then(
      (data) => setState({ key: readKey, value: { data, loading: false, error: null } }),
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ key: readKey, value: { data: null, loading: false, error } })
      },
    )
    return () => controller.abort()
    // `load` is a fresh closure on every render; the read key names what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKey, enabled])

  if (!enabled) return { data: null, loading: false, error: null, retry }
  if (state.key !== readKey) return { data: null, loading: true, error: null, retry }
  return { ...state.value, retry }
}
