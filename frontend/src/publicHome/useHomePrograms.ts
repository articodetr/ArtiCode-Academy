// The programs of the public home page: one page of API-236 (no token, no
// session refresh — `listPublicCatalog`), of which `homeProgramsOf()` picks the
// cards to show (those taking a learner now) while ALL are summed into the page's
// figures. Read once per mount; `retry()` asks again. A newer request aborts the
// older one and its answer is dropped.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listPublicCatalog } from '../api/publicCatalog'
import type { PublicCourseCard } from '../api/publicCatalog'
import { HOME_CATALOG_READ_LIMIT, homeProgramsOf, homeProgramsStateOf, homeStatsOf } from './publicHome.view'
import type { HomeProgramsState, HomeStats } from './publicHome.view'

interface State {
  attempt: number
  items: PublicCourseCard[]
  /** The catalog has courses after the ones read. */
  more: boolean
  error: unknown
}

export interface HomePrograms {
  state: HomeProgramsState
  /** The cards to show. */
  items: PublicCourseCard[]
  /** At least one card shown takes a learner now; false = they are shown for reading only. */
  joinable: boolean
  /** The catalog holds courses beyond the cards shown. */
  more: boolean
  /** The figures of the courses read; null until some are. */
  stats: HomeStats | null
  error: unknown
  retry: () => void
}

export function useHomePrograms(): HomePrograms {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<State>({ attempt: -1, items: [], more: false, error: null })

  useEffect(() => {
    const controller = new AbortController()
    listPublicCatalog({ limit: HOME_CATALOG_READ_LIMIT }, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) setState({ attempt, items: page.items, more: page.nextCursor !== null, error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ attempt, items: [], more: false, error })
      },
    )
    return () => controller.abort()
  }, [attempt])

  const loading = state.attempt !== attempt
  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  return useMemo(() => {
    const selection = homeProgramsOf(loading ? [] : state.items)
    return {
      // The state counts every card read: «كل البرامج» stays whenever the catalog has any course.
      state: homeProgramsStateOf({ loading, error: state.error, count: state.items.length }),
      items: selection.cards,
      joinable: selection.joinable,
      more: !loading && (state.more || state.items.length > selection.cards.length),
      stats: loading ? null : homeStatsOf(state.items, state.more),
      error: loading ? null : state.error,
      retry,
    }
  }, [loading, state, retry])
}
