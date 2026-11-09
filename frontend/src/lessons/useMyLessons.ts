// State of the «my lessons» table (J-F11): API-101 through the shared keyset
// hook. The view decides the time window and the order (myLessonsQuery), so a
// view change restarts from the first page like any other filter; its days
// are days of `dayZone` — the academy's (D-R41 — J-F28).
import { useMemo } from 'react'
import { listMyLessons } from '../api/myLessons'
import type { MyLessonItem } from '../api/myLessons'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'
import { defaultMyLessonsFilters, myLessonsQuery } from './myLessons.view'
import type { MyLessonsFilters } from './myLessons.view'

function myLessonsLoader(dayZone: string): KeysetLoader<MyLessonItem, MyLessonsFilters> {
  return (filters, cursor, signal) => listMyLessons({ ...myLessonsQuery(filters, dayZone), cursor }, signal)
}

/** `dayZone` = the zone of «today» and the range days (the academy's — useAcademyZone()); the page mounts the list once it is known. */
export function useMyLessons(dayZone: string, initialFilters: MyLessonsFilters = defaultMyLessonsFilters()) {
  // One loader per zone, so the keyset hook never reloads on a re-render.
  const load = useMemo(() => myLessonsLoader(dayZone), [dayZone])
  return useKeysetList(load, initialFilters)
}
