// State of the assignments table (J-F38): API-102 through the shared keyset
// hook, with the filters the contract supports — class, status, a due-date
// range and the order (by due date, assignments without one last). The two
// days of the range are calendar days of `timeZone` (the academy's — this
// device's until it is known — assignments.zone.ts) turned into the instants
// the server compares: `dueFrom` = the first millisecond of the day, `dueTo`
// = the last. No default range: an assignment without a due date (a fresh
// draft) never matches one, so a default would hide it.
import { listAssignments } from '../api/assignments'
import type { Assignment, AssignmentSortOrder, AssignmentStatus } from '../api/assignments'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'
import { dayEndIn, dayStartIn } from './assignments.zone'

export const ASSIGNMENT_PAGE_SIZES = [20, 50, 100] as const

/** The statuses the first version uses (D-R37): `grading`/`graded` are never reached, so the filter does not offer them. */
export const ASSIGNMENT_FILTER_STATUSES = ['draft', 'open', 'closed'] as const satisfies readonly AssignmentStatus[]

export interface AssignmentsListFilters {
  classId: string | undefined
  status: AssignmentStatus | undefined
  /** Calendar days (`YYYY-MM-DD`) of `timeZone`; blank = open-ended. */
  dueFrom: string | undefined
  dueTo: string | undefined
  /** The zone the two days are read in. */
  timeZone: string
  order: AssignmentSortOrder
  limit: (typeof ASSIGNMENT_PAGE_SIZES)[number]
}

/** Every assignment by due date, earliest first (the server's default order), 20 per page. */
export function defaultAssignmentFilters(timeZone: string): AssignmentsListFilters {
  return { classId: undefined, status: undefined, dueFrom: undefined, dueTo: undefined, timeZone, order: 'asc', limit: 20 }
}

/** True when the list is narrowed: a class, a status or a due day (the order, the page size and the zone narrow nothing). */
export function hasActiveAssignmentFilters(filters: AssignmentsListFilters): boolean {
  return Boolean(filters.classId || filters.status || filters.dueFrom || filters.dueTo)
}

const loadAssignments: KeysetLoader<Assignment, AssignmentsListFilters> = (filters, cursor, signal) =>
  listAssignments(
    {
      classId: filters.classId,
      status: filters.status,
      dueFrom: dayStartIn(filters.dueFrom, filters.timeZone),
      dueTo: dayEndIn(filters.dueTo, filters.timeZone),
      order: filters.order,
      limit: filters.limit,
      cursor,
    },
    signal,
  )

export function useAssignmentsList(initialFilters: AssignmentsListFilters) {
  return useKeysetList(loadAssignments, initialFilters)
}
