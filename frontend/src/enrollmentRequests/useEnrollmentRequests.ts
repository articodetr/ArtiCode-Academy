// State of the office's requests list (MOD-19, API-224) on the shared keyset
// hook, plus the server's academy-wide `pendingCount` of the last page read.
import { useCallback, useState } from 'react'
import { listEnrollmentRequests } from '../api/enrollmentRequests'
import type { EnrollmentRequest, RequestListState } from '../api/enrollmentRequests'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'
import { DEFAULT_REQUEST_STATE } from './requests.format'

export const REQUESTS_PAGE_SIZE = 50

export interface RequestsListFilters {
  state: RequestListState
  q: string | undefined
}

export const DEFAULT_REQUESTS_FILTERS: RequestsListFilters = { state: DEFAULT_REQUEST_STATE, q: undefined }

export function useEnrollmentRequests() {
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  // Stable for the life of the page (useKeysetList reloads when its loader changes): only the state setter is captured.
  const load = useCallback<KeysetLoader<EnrollmentRequest, RequestsListFilters>>(
    (filters, cursor, signal) =>
      listEnrollmentRequests({ state: filters.state, q: filters.q, limit: REQUESTS_PAGE_SIZE, cursor }, signal).then((page) => {
        if (!signal.aborted) setPendingCount(page.pendingCount)
        return page
      }),
    [],
  )
  const list = useKeysetList(load, DEFAULT_REQUESTS_FILTERS)
  return { ...list, pendingCount }
}
