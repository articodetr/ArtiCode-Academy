// State of the «my lessons» table (J-F11): API-101 through the shared keyset
// hook. The view decides the time window and the order (myLessonsQuery), so a
// view change restarts from the first page like any other filter.
import { listMyLessons } from '../api/myLessons'
import type { MyLessonItem } from '../api/myLessons'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'
import { defaultMyLessonsFilters, myLessonsQuery } from './myLessons.view'
import type { MyLessonsFilters } from './myLessons.view'

const loadMyLessons: KeysetLoader<MyLessonItem, MyLessonsFilters> = (filters, cursor, signal) => listMyLessons({ ...myLessonsQuery(filters), cursor }, signal)

export function useMyLessons(initialFilters: MyLessonsFilters = defaultMyLessonsFilters()) {
  return useKeysetList(loadMyLessons, initialFilters)
}
