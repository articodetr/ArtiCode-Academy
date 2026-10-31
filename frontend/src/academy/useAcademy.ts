// State of the academy settings screen (MOD-02/MOD-14): the single row of
// GET /api/academy, reloadable, replaced only by what the server returned for
// a write (no optimism) — the pattern of roles/useRoles.ts.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAcademy } from '../api/academy'
import type { Academy } from '../api/academy'

interface AcademyState {
  /** Identifies the request this state answers; a different key on screen means loading. */
  key: number
  academy: Academy | null
  error: unknown
}

const INITIAL: AcademyState = { key: -1, academy: null, error: null }

export function useAcademy() {
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<AcademyState>(INITIAL)
  const loading = state.key !== tick

  useEffect(() => {
    const controller = new AbortController()
    getAcademy(controller.signal)
      .then((academy) => {
        if (controller.signal.aborted) return
        setState({ key: tick, academy, error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        // Keep what was on screen behind the error message.
        setState((current) => ({ ...current, key: tick, error }))
      })
    return () => controller.abort()
  }, [tick])

  const reload = useCallback(() => setTick((value) => value + 1), [])

  /** After a successful PATCH: the screen shows the academy as the response returned it. */
  const replace = useCallback((academy: Academy) => {
    setState((current) => ({ ...current, academy, error: null }))
  }, [])

  return useMemo(() => ({ academy: state.academy, loading, error: state.error, reload, replace }), [state, loading, reload, replace])
}
