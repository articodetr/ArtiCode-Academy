// The inbox list (API-167): newest first, «load more» appends the next keyset
// page. Any filter change or reload starts again from the first page; a
// request still on its way is abandoned. A failed «load more» keeps the rows
// and lets it be tried again.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listMyNotifications } from '../api/notifications'
import type { MyNotification, NotificationCategory } from '../api/notifications'

export const INBOX_PAGE_SIZE = 20

export interface InboxFilters {
  unread: boolean
  category?: NotificationCategory
}

interface InboxState {
  key: string
  items: MyNotification[]
  nextCursor: string | null
  error: unknown
}

export function useInbox() {
  const [filters, setFiltersState] = useState<InboxFilters>({ unread: false })
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<InboxState>({ key: '', items: [], nextCursor: null, error: null })
  const requestKey = JSON.stringify([filters, cursor, tick])
  const loading = state.key !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    listMyNotifications({ ...filters, limit: INBOX_PAGE_SIZE, cursor }, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return
        setState((current) => ({
          key: requestKey,
          items: cursor ? [...current.items, ...page.items.filter((item) => !current.items.some((row) => row.id === item.id))] : page.items,
          nextCursor: page.nextCursor,
          error: null,
        }))
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState((current) => ({ ...current, key: requestKey, items: cursor ? current.items : [], error }))
      },
    )
    return () => controller.abort()
  }, [filters, cursor, requestKey])

  const setFilters = useCallback((patch: Partial<InboxFilters>) => {
    setFiltersState((current) => ({ ...current, ...patch }))
    setCursor(undefined)
  }, [])

  const loadMore = useCallback(() => {
    if (state.nextCursor) setCursor(state.nextCursor)
  }, [state.nextCursor])

  const reload = useCallback(() => {
    setCursor(undefined)
    setTick((value) => value + 1)
  }, [])

  /** Asks the failed page again (the first page, or the next one after a failed «load more»). */
  const retry = useCallback(() => setTick((value) => value + 1), [])

  const replaceItem = useCallback((item: MyNotification) => {
    setState((current) => ({ ...current, items: current.items.map((row) => (row.id === item.id ? item : row)) }))
  }, [])

  return useMemo(
    () => ({ filters, setFilters, items: state.items, nextCursor: state.nextCursor, error: state.error, loading, loadMore, reload, retry, replaceItem }),
    [filters, setFilters, state, loading, loadMore, reload, retry, replaceItem],
  )
}
