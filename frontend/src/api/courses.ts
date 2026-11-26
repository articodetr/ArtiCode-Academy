// Courses (MOD-04-T03): API-042..API-047. Types mirror
// backend/src/courses/courses.dto.ts; every call goes through apiRequest
// (Bearer header, refresh-and-retry on 401). Holders of `courses.read` alone
// only ever receive published courses (D-R13) — the server decides.
// PORTAL-04: a course names its school subject (`subject`, api/subjects.ts) beside
// its difficulty (`level`). The age range stays in the DTO and the API, but no
// form sends it any more (a PATCH that leaves it out keeps the stored values).
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

/** PORTAL-04: the course's school subject (`subjects`), never its difficulty (`level`). */
export interface CourseSubject {
  id: string
  code: string
  name: LocalizedLabel
}

/** MOD-19 (D-R122): `free` unless the course names the fee plan that prices a request. */
export type CoursePricing = 'free' | 'paid'

/** `CourseFeePlanDto` (MOD-19): the plan that prices a request — its total in the academy currency (D15). */
export interface CourseFeePlan {
  id: string
  name: LocalizedLabel
  /** false = deactivated: requests are refused with `course_price_unavailable`. */
  isActive: boolean
  total: number
  currency: string
  installments: number
}

/** `CourseDto` (API-042..API-046). */
export interface Course {
  id: string
  code: string
  name: LocalizedLabel
  summary: LocalizedLabel | null
  description: LocalizedLabel | null
  level: CourseLevel | null
  /** PORTAL-04: null for a course without a subject. */
  subject: CourseSubject | null
  status: CourseStatus
  durationHours: number | null
  sessionsCount: number | null
  minAge: number | null
  maxAge: number | null
  syllabusCount: number
  /** MOD-19 (D-R129): an absolute http(s) URL of the cover image, or null. */
  coverImageUrl: string | null
  /** J-F67: the course's own materials (its textbook), shown on its card in «دوراتي»; absent from an older server. */
  resources?: CourseResource[]
  /** MOD-19: paid exactly when `enrollmentFeePlan` is set. */
  pricing: CoursePricing
  enrollmentFeePlan: CourseFeePlan | null
  createdAt: string
  updatedAt: string
}

export interface CourseList {
  items: Course[]
  nextCursor: string | null
}

/** Upper bound of `q` on API-042 (`ListCoursesQueryDto`: 1–100 characters after trim). */
export const COURSE_SEARCH_MAX_LENGTH = 100

export interface ListCoursesParams {
  /** Code or Arabic/English name substring; at most COURSE_SEARCH_MAX_LENGTH characters. */
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
  /** Absent = the server generates a unique code; the course form sends none since the simplified form. */
  code?: string
  name: LocalizedLabel
  summary?: LocalizedLabel
  description?: LocalizedLabel
  levelId?: string
  /** PORTAL-04: an active subject (`404 subject_not_found` / `422 subject_inactive` otherwise). */
  subjectId?: string
  durationHours?: number
  sessionsCount?: number
  /** Still accepted by the server; the course forms no longer send it (PORTAL-04). */
  minAge?: number
  maxAge?: number
  /** MOD-19: an absolute http(s) URL (no upload). */
  coverImageUrl?: string
  /** MOD-19: an active general fee plan (no course, no class — the course does not exist yet); needs `fee_plans.manage` besides `courses.manage`. */
  enrollmentFeePlanId?: string
}

/** Body of API-045 (`UpdateCourseDto`): absent = unchanged, null clears the optional fields. */
export interface UpdateCourseInput {
  code?: string
  name?: LocalizedLabel
  summary?: LocalizedLabel | null
  description?: LocalizedLabel | null
  levelId?: string | null
  /** PORTAL-04: null clears the subject. */
  subjectId?: string | null
  durationHours?: number | null
  sessionsCount?: number | null
  /** Still accepted by the server; the course forms no longer send it (PORTAL-04). */
  minAge?: number | null
  maxAge?: number | null
  /** MOD-19: null clears the cover. */
  coverImageUrl?: string | null
  /** MOD-19 (D-R122): a fee plan of this course or a general one; null = free again. Needs `fee_plans.manage`. */
  enrollmentFeePlanId?: string | null
  /** J-F67: the course's materials as a whole new list (at most 20, https only); [] removes them. */
  resources?: CourseResource[]
}

/** One of a course's own materials (J-F67): a title and an https address, as a lesson's resource. */
export interface CourseResource {
  title: LocalizedLabel
  url: string
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
