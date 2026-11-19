// State of the public catalog list (API-236): a search and the keyset pages
// shown one after another — «المزيد» appends the next page under the cards
// already on screen; a new search starts from the first page again. A newer
// request aborts the older one and a stale answer is dropped. A failure keeps
// the cards on screen; `retry()` asks for the same page again.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listPublicCatalog } from '../api/publicCatalog'
import type { PublicCourseCard } from '../api/publicCatalog'
import { appendCards, publicCatalogParams } from './publicCatalog.view'

interface ListState {
  key: string
  items: PublicCourseCard[]
  nextCursor: string | null
  error: unknown
}

export function usePublicCatalogList() {
  const [query, setQueryState] = useState('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ListState>({ key: '', items: [], nextCursor: null, error: null })
  const requestKey = JSON.stringify([query, cursor ?? null, attempt])

  useEffect(() => {
    const controller = new AbortController()
    listPublicCatalog(publicCatalogParams(query, cursor), controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return
        setState((current) => ({
          key: requestKey,
          // The first page replaces the cards; a later one comes after them.
          items: cursor ? appendCards(current.items, page.items) : page.items,
          nextCursor: page.nextCursor,
          error: null,
        }))
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState((current) => ({ ...current, key: requestKey, error }))
      },
    )
    return () => controller.abort()
  }, [query, cursor, requestKey])

  const loading = state.key !== requestKey

  const setQuery = useCallback((value: string) => {
    setQueryState(value.trim())
    setCursor(undefined)
  }, [])

  const { nextCursor } = state
  const more = useCallback(() => {
    if (nextCursor) setCursor(nextCursor)
  }, [nextCursor])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  return useMemo(
    () => ({
      query,
      setQuery,
      items: state.items,
      /** The cursor of the page after the last one shown; null at the end. */
      nextCursor: state.nextCursor,
      loading,
      error: state.error,
      /** True while the failure belongs to a later page (the cards above it stay valid). */
      failedMore: state.error !== null && cursor !== undefined,
      more,
      retry,
    }),
    [query, setQuery, state, loading, cursor, more, retry],
  )
}
