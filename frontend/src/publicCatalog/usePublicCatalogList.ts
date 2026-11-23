// State of the public catalog list (API-236): the search the page asks for and
// the keyset pages shown one after another — «المزيد» appends the next page under
// the cards already on screen; another search starts from the first page again.
// A newer request aborts the older one and a stale answer is dropped. A failure
// keeps the cards on screen; `retry()` asks for the same page again.
// The search is the caller's (PORTAL-04 PR-2: /explore keeps it in its address,
// the one place it lives): the hook holds no copy of it, so two sources can never
// disagree about which search is on screen. No manual memoization: the page reads
// the result and calls more()/retry() from clicks only, nothing depends on identity.
import { useEffect, useState } from 'react'
import { listPublicCatalog } from '../api/publicCatalog'
import type { PublicCourseCard } from '../api/publicCatalog'
import { appendCards, publicCatalogParams } from './publicCatalog.view'

interface ListState {
  key: string
  /** The search the cards on screen were read for. */
  query: string
  items: PublicCourseCard[]
  nextCursor: string | null
  error: unknown
}

export function usePublicCatalogList(search: string) {
  const query = search.trim()
  // The page after the cards on screen, asked with «المزيد». It extends only the list it was asked under: another
  // search reads its own first page (whose answer forgets it), so coming back never resumes a stale page.
  const [later, setLater] = useState<{ query: string; cursor: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ListState>({ key: '', query: '', items: [], nextCursor: null, error: null })
  const cursor = later !== null && later.query === query && state.query === query ? later.cursor : undefined
  const requestKey = JSON.stringify([query, cursor ?? null, attempt])

  useEffect(() => {
    const controller = new AbortController()
    listPublicCatalog(publicCatalogParams(query, cursor), controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return
        // A first page starts a new list: a «المزيد» page of an earlier one no longer applies.
        if (!cursor) setLater(null)
        setState((current) => ({
          key: requestKey,
          query,
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

  const { nextCursor } = state

  return {
    query,
    items: state.items,
    /** The cursor of the page after the last one shown; null at the end. */
    nextCursor,
    loading,
    error: state.error,
    /** True while the failure belongs to a later page (the cards above it stay valid). */
    failedMore: state.error !== null && cursor !== undefined,
    more: () => {
      if (nextCursor) setLater({ query, cursor: nextCursor })
    },
    retry: () => setAttempt((count) => count + 1),
  }
}
