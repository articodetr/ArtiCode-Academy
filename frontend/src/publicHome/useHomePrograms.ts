// The programs of the public home page: the first HOME_PROGRAMS_LIMIT courses
// of API-236 (no token, no session refresh — `listPublicCatalog`). Read once per
// mount; `retry()` asks again. A newer request aborts the older one and its
// answer is dropped.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listPublicCatalog } from '../api/publicCatalog'
import type { PublicCourseCard } from '../api/publicCatalog'
import { HOME_PROGRAMS_LIMIT, homeProgramsStateOf } from './publicHome.view'
import type { HomeProgramsState } from './publicHome.view'

interface State {
  attempt: number
  items: PublicCourseCard[]
  /** The catalog has courses after the ones shown. */
  more: boolean
  error: unknown
}

export interface HomePrograms {
  state: HomeProgramsState
  items: PublicCourseCard[]
  more: boolean
  error: unknown
  retry: () => void
}

export function useHomePrograms(): HomePrograms {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<State>({ attempt: -1, items: [], more: false, error: null })

  useEffect(() => {
    const controller = new AbortController()
    listPublicCatalog({ limit: HOME_PROGRAMS_LIMIT }, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) setState({ attempt, items: page.items.slice(0, HOME_PROGRAMS_LIMIT), more: page.nextCursor !== null, error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ attempt, items: [], more: false, error })
      },
    )
    return () => controller.abort()
  }, [attempt])

  const loading = state.attempt !== attempt
  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  return useMemo(
    () => ({
      state: homeProgramsStateOf({ loading, error: state.error, count: state.items.length }),
      items: loading ? [] : state.items,
      more: !loading && state.more,
      error: loading ? null : state.error,
      retry,
    }),
    [loading, state, retry],
  )
}
