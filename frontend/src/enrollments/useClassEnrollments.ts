// State of a class roster (J-F04): API-057 through the shared keyset hook.
// The class id travels in the filters, so switching classes restarts from the
// first page like any filter change.
import { listEnrollments } from '../api/enrollments'
import type { Enrollment, EnrollmentStatus } from '../api/enrollments'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'

export const ENROLLMENT_PAGE_SIZE = 50

export interface EnrollmentsListFilters {
  classId: string
  status: EnrollmentStatus | undefined
}

const loadEnrollments: KeysetLoader<Enrollment, EnrollmentsListFilters> = (filters, cursor, signal) =>
  listEnrollments(filters.classId, { status: filters.status, limit: ENROLLMENT_PAGE_SIZE, cursor }, signal)

export function useClassEnrollments(classId: string) {
  const initial: EnrollmentsListFilters = { classId, status: undefined }
  return useKeysetList(loadEnrollments, initial)
}
