import { useCallback, useEffect, useState } from 'react'
import { ApiError } from './client'
import { fetchHealth, fetchReadiness } from './health'
import type { HealthReport, ReadinessReport } from './health'

export type EndpointState<T> =
  | { kind: 'checking' }
  | { kind: 'ok'; data: T; checkedAt: Date }
  | { kind: 'error'; error: string; checkedAt: Date }

function describeError(error: unknown): string {
  if (error instanceof ApiError) return `${error.status}: ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Calls `fetcher` on mount and on every `refresh()`.
 * `fetcher` must be a stable (module-level) function; an inline one would refetch on each render.
 */
export function useEndpoint<T>(fetcher: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<EndpointState<T>>({ kind: 'checking' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    fetcher(controller.signal)
      .then((data) => setState({ kind: 'ok', data, checkedAt: new Date() }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ kind: 'error', error: describeError(error), checkedAt: new Date() })
      })

    return () => controller.abort()
  }, [fetcher, attempt])

  // The "checking" state is set from the event, not inside the effect.
  const refresh = useCallback(() => {
    setState({ kind: 'checking' })
    setAttempt((n) => n + 1)
  }, [])

  return { state, refresh }
}

export function useHealth() {
  return useEndpoint<HealthReport>(fetchHealth)
}

export function useReadiness() {
  return useEndpoint<ReadinessReport>(fetchReadiness)
}
