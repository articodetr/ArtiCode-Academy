// State of the «my exams» table (J-F50): API-121 through the shared keyset
// hook; any filter change restarts from the first page (myExamsQuery).
// Since MOD-09 phase 2 the loader also notes the moment a page arrived for
// each attempt in progress it carries: the row counts the server's
// `remainingSeconds` down from that moment on the monotonic clock
// (takeExam/takeExam.clock.ts) — never from the device's date, and never from
// the moment the row happened to be drawn.
import { listMyExams } from '../api/myExams'
import type { MyExamItem } from '../api/myExams'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'
import { markArrival, monotonicNow } from '../takeExam/takeExam.clock'
import { myExamsQuery } from './myExams.view'
import type { MyExamsFilters } from './myExams.view'

const loadMyExams: KeysetLoader<MyExamItem, MyExamsFilters> = async (filters, cursor, signal) => {
  const page = await listMyExams({ ...myExamsQuery(filters), cursor }, signal)
  const arrivedAt = monotonicNow()
  for (const item of page.items) if (item.online?.inProgress) markArrival(item.online.inProgress, arrivedAt)
  return page
}

export function useMyExams(initialFilters: MyExamsFilters) {
  return useKeysetList(loadMyExams, initialFilters)
}
