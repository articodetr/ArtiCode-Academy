// State of the «my assignments» table (J-F42): API-112 through the shared
// keyset hook. The view decides the status, the `pending` filter and the order
// (myAssignmentsQuery), so a view change restarts from the first page like any
// other filter.
import { listMyAssignments } from '../api/myAssignments'
import type { MyAssignmentItem } from '../api/myAssignments'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'
import { myAssignmentsQuery } from './myAssignments.view'
import type { MyAssignmentsFilters } from './myAssignments.view'

const loadMyAssignments: KeysetLoader<MyAssignmentItem, MyAssignmentsFilters> = (filters, cursor, signal) =>
  listMyAssignments({ ...myAssignmentsQuery(filters), cursor }, signal)

export function useMyAssignments(initialFilters: MyAssignmentsFilters) {
  return useKeysetList(loadMyAssignments, initialFilters)
}
