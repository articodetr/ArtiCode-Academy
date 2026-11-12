// State of the «my exams» table (J-F50): API-121 through the shared keyset
// hook; any filter change restarts from the first page (myExamsQuery).
import { listMyExams } from '../api/myExams'
import type { MyExamItem } from '../api/myExams'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'
import { myExamsQuery } from './myExams.view'
import type { MyExamsFilters } from './myExams.view'

const loadMyExams: KeysetLoader<MyExamItem, MyExamsFilters> = (filters, cursor, signal) => listMyExams({ ...myExamsQuery(filters), cursor }, signal)

export function useMyExams(initialFilters: MyExamsFilters) {
  return useKeysetList(loadMyExams, initialFilters)
}
