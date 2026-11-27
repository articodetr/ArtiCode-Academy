// PORTAL-04-COURSE-ORDER: when the arrows of the courses list may move a course. Only in the plain office order — no
// search and no status filter narrow the rows — so a move is always between the rows the manager sees (the server
// swaps a course with its neighbour among every course, POST /api/courses/:id/move).
import type { CoursesListFilters } from './useCoursesList'

export function canReorderCourses(filters: Pick<CoursesListFilters, 'sort' | 'q' | 'status'>): boolean {
  return filters.sort === 'position' && filters.q.trim() === '' && filters.status === undefined
}
