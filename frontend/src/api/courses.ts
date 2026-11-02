// Courses (MOD-04-T03): API-042..API-047. Types mirror
// backend/src/courses/courses.dto.ts; every call goes through apiRequest
// (Bearer header, refresh-and-retry on 401). Holders of `courses.read` alone
// only ever receive published courses (D-R13) — the server decides.
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

export const COURSE_STATUSES = ['draft', 'published', 'archived'] as const
export type CourseStatus = (typeof COURSE_STATUSES)[number]

export const COURSE_STATUS_ACTIONS = ['publish', 'unpublish', 'archive', 'restore'] as const
export type CourseStatusAction = (typeof COURSE_STATUS_ACTIONS)[number]

export const COURSE_SORT_FIELDS = ['code', 'createdAt'] as const
export type CourseSortField = (typeof COURSE_SORT_FIELDS)[number]

export interface CourseLevel {
  id: string
  code: string
  name: LocalizedLabel
  isActive: boolean
}

/** `CourseDto` (API-042..API-046). */
export interface Course {
  id: string
  code: string
  name: LocalizedLabel
  summary: LocalizedLabel | null
  description: LocalizedLabel | null
  level: CourseLevel | null
  status: CourseStatus
  durationHours: number | null
  sessionsCount: number | null
  minAge: number | null
  maxAge: number | null
  syllabusCount: number
  createdAt: string
  updatedAt: string
}

export interface CourseList {
  items: Course[]
  nextCursor: string | null
}

export interface ListCoursesParams {
  q?: string
  /** Any status for `courses.manage`; others only `published` (anything else is 403). */
  status?: CourseStatus
  levelId?: string
  sort?: CourseSortField
  order?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

/** Body of API-044 (`CreateCourseDto`): the course starts as a draft. */
export interface CreateCourseInput {
  code: string
  name: LocalizedLabel
  summary?: LocalizedLabel
  description?: LocalizedLabel
  levelId?: string
  durationHours?: number
  sessionsCount?: number
  minAge?: number
  maxAge?: number
}

/** Body of API-045 (`UpdateCourseDto`): absent = unchanged, null clears the optional fields. */
export interface UpdateCourseInput {
  code?: string
  name?: LocalizedLabel
  summary?: LocalizedLabel | null
  description?: LocalizedLabel | null
  levelId?: string | null
  durationHours?: number | null
  sessionsCount?: number | null
  minAge?: number | null
  maxAge?: number | null
}

export const COURSES_PATH = '/api/courses'

/** `/api/courses?…` with the non-empty parameters only (trimmed search). */
export function coursesListPath(params: ListCoursesParams = {}): string {
  const query = new URLSearchParams()
  const q = params.q?.trim()
  if (q) query.set('q', q)
  if (params.status) query.set('status', params.status)
  if (params.levelId) query.set('levelId', params.levelId)
  if (params.sort) query.set('sort', params.sort)
  if (params.order) query.set('order', params.order)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${COURSES_PATH}?${search}` : COURSES_PATH
}

const coursePath = (id: string) => `${COURSES_PATH}/${encodeURIComponent(id)}`

export function listCourses(params: ListCoursesParams = {}, signal?: AbortSignal): Promise<CourseList> {
  return apiRequest<CourseList>(coursesListPath(params), { signal })
}

export function getCourse(id: string, signal?: AbortSignal): Promise<Course> {
  return apiRequest<Course>(coursePath(id), { signal })
}

export function createCourse(input: CreateCourseInput): Promise<Course> {
  return apiRequest<Course>(COURSES_PATH, { method: 'POST', body: input })
}

export function updateCourse(id: string, input: UpdateCourseInput): Promise<Course> {
  return apiRequest<Course>(coursePath(id), { method: 'PATCH', body: input })
}

export function changeCourseStatus(id: string, action: CourseStatusAction): Promise<Course> {
  return apiRequest<Course>(`${coursePath(id)}/status`, { method: 'POST', body: { action } })
}

/** API-047: drafts only (`course_not_deletable` otherwise); resolves on 204. */
export function deleteCourse(id: string): Promise<void> {
  return apiRequest<void>(coursePath(id), { method: 'DELETE' })
}
