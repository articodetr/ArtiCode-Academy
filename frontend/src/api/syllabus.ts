// Course syllabus (MOD-04-T04): API-048 GET /api/courses/:id/syllabus — the flat
// list of a course's lessons, read by the lesson forms (useSyllabusItems).
// Types mirror backend/src/courses/syllabus.dto.ts. Reading follows the
// course's visibility (D-R13). The course drawer edits the lessons through the
// curriculum (MOD-20, api/curriculum.ts — levels, lessons and their content)
// since API-049's flat editor was replaced, so this client no longer writes.
import { apiRequest } from './client'
import { COURSES_PATH } from './courses'
import type { LocalizedLabel } from './users'

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

export const syllabusPath = (courseId: string) => `${COURSES_PATH}/${encodeURIComponent(courseId)}/syllabus`

export function getSyllabus(courseId: string, signal?: AbortSignal): Promise<Syllabus> {
  return apiRequest<Syllabus>(syllabusPath(courseId), { signal })
}
