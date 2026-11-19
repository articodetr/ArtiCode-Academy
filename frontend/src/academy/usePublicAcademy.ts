// The academy as a visitor sees it (API-205 GET /api/academy/public): the
// sign-in page reads it to know whether to offer «تصفّح الدورات» (MOD-20,
// D-R138 — `catalogPublic`), the public catalog pages for their header (name and
// logo). Read once per mount, without a token and without a session refresh; a
// failure (429 included) is quiet — the pages then show the static product name
// and no link, never an error banner. `enabled: false` reads nothing (the sign-in
// page waits until it knows there is no session to restore).
import { useEffect, useState } from 'react'
import { getPublicAcademy } from '../api/academy'
import type { PublicAcademy } from '../api/academy'

export interface PublicAcademyReading {
  academy: PublicAcademy | null
  /** True until the first answer (or failure) arrives; false while disabled. */
  loading: boolean
  error: unknown
}

interface State {
  done: boolean
  academy: PublicAcademy | null
  error: unknown
}

export function usePublicAcademy(enabled = true): PublicAcademyReading {
  const [state, setState] = useState<State>({ done: false, academy: null, error: null })

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    getPublicAcademy(controller.signal).then(
      (academy) => {
        if (!controller.signal.aborted) setState({ done: true, academy, error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ done: true, academy: null, error })
      },
    )
    return () => controller.abort()
  }, [enabled])

  return { academy: state.academy, loading: enabled && !state.done, error: state.error }
}
