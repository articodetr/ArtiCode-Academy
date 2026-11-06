// The room list of the rooms screen (API-084), on the pattern of
// courses/useLevels.ts: the server filters (`branchId`, `kind`) are part of the
// request, loading is derived from the request key, in-flight requests are
// aborted when the filters change, a failure keeps the last list behind the
// error, and every successful write re-reads the list from the server (it
// orders the rooms: the academy's own site first, then by branch code, then by
// room code — a single returned row never tells the whole story).
import { useCallback, useEffect, useState } from 'react'
import { listRooms } from '../api/rooms'
import type { ListRoomsParams, Room } from '../api/rooms'

export interface RoomsState {
  rooms: Room[]
  loading: boolean
  /** The last load failure, or null. */
  error: unknown
  /** The server filters of the current list. */
  filters: ListRoomsParams
  /** Replaces the given filters (undefined clears one) and reloads. */
  setFilters: (patch: Partial<ListRoomsParams>) => void
  reload: () => void
}

export function useRooms(initial: ListRoomsParams = {}): RoomsState {
  const [rooms, setRooms] = useState<Room[]>([])
  const [error, setError] = useState<unknown>(null)
  const [filters, setFiltersState] = useState<ListRoomsParams>(initial)
  const [requestKey, setRequestKey] = useState(0)
  const [settledKey, setSettledKey] = useState(-1)

  useEffect(() => {
    const controller = new AbortController()
    listRooms(filters, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setRooms(result.items)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught)
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettledKey(requestKey)
      })
    return () => controller.abort()
  }, [filters, requestKey])

  const reload = useCallback(() => setRequestKey((key) => key + 1), [])

  const setFilters = useCallback((patch: Partial<ListRoomsParams>) => {
    setFiltersState((current) => {
      const next: ListRoomsParams = { ...current }
      for (const [key, value] of Object.entries(patch) as [keyof ListRoomsParams, string | undefined][]) {
        if (value === undefined || value === '') delete next[key]
        else (next as Record<string, string>)[key] = value
      }
      return next
    })
    setRequestKey((key) => key + 1)
  }, [])

  return { rooms, loading: settledKey !== requestKey, error, filters, setFilters, reload }
}
