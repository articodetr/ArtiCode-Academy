// Course syllabus (MOD-04-T04): API-048 GET and API-049 PUT
// /api/courses/:id/syllabus. Types mirror backend/src/courses/syllabus.dto.ts.
// Reading follows the course's visibility (D-R13); the PUT replaces the whole
// ordered list (items with an `id` are kept, without one are created, missing
// ones are deleted) and needs `courses.manage`.
import { apiRequest } from './client'
import { COURSES_PATH } from './courses'
import type { LocalizedLabel } from './users'

/** At most 200 items, each at most a day (1440 minutes) — mirrors of the DTO limits. */
export const SYLLABUS_ITEMS_MAX = 200
export const SYLLABUS_MINUTES_MAX = 1440

export interface SyllabusItem {
  id: string
  sortOrder: number
  title: LocalizedLabel
  description: LocalizedLabel | null
  estimatedMinutes: number | null
  createdAt: string
  updatedAt: string
}

export interface Syllabus {
  courseId: string
  items: SyllabusItem[]
}

/** One item of the PUT body: no `id` = a new item; absent optional fields = no value. */
export interface SyllabusItemInput {
  id?: string
  title: LocalizedLabel
  description?: LocalizedLabel | null
  estimatedMinutes?: number | null
}

export const syllabusPath = (courseId: string) => `${COURSES_PATH}/${encodeURIComponent(courseId)}/syllabus`

export function getSyllabus(courseId: string, signal?: AbortSignal): Promise<Syllabus> {
  return apiRequest<Syllabus>(syllabusPath(courseId), { signal })
}

/** The complete syllabus in its new order (first item = position 0). */
export function replaceSyllabus(courseId: string, items: SyllabusItemInput[]): Promise<Syllabus> {
  return apiRequest<Syllabus>(syllabusPath(courseId), { method: 'PUT', body: { items } })
}
