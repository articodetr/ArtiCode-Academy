// State of the classes table (J-F01): API-050 through the shared keyset hook.
import { listClasses } from '../api/classes'
import type { AcademyClass, ClassSortField, ClassStatus } from '../api/classes'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'

export const CLASS_PAGE_SIZES = [20, 50, 100] as const

export interface ClassesListFilters {
  q: string
  status: ClassStatus | undefined
  courseId: string | undefined
  /** Classes this user teaches — offered to managers only (a teacher sees only their own classes anyway). */
  teacherId: string | undefined
  sort: ClassSortField
  limit: (typeof CLASS_PAGE_SIZES)[number]
}

export const DEFAULT_CLASS_FILTERS: ClassesListFilters = {
  q: '',
  status: undefined,
  courseId: undefined,
  teacherId: undefined,
  sort: 'code',
  limit: 20,
}

const loadClasses: KeysetLoader<AcademyClass, ClassesListFilters> = (filters, cursor, signal) => listClasses({ ...filters, cursor }, signal)

export function useClassesList(initialFilters: ClassesListFilters = DEFAULT_CLASS_FILTERS) {
  return useKeysetList(loadClasses, initialFilters)
}
