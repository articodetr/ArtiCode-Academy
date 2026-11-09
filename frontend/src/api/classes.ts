// Classes (MOD-05-T02/T03): API-050..API-056. Types mirror
// backend/src/classes/classes.dto.ts and class-teachers.dto.ts; every call goes
// through apiRequest (Bearer header, refresh-and-retry on 401). Holders of
// `classes.read` alone only ever receive the classes they are assigned to
// (D-R16) — the server decides.
import { apiRequest } from './client'
import type { CourseStatus } from './courses'
import type { LocalizedLabel } from './users'

export const CLASS_STATUSES = ['planned', 'open', 'running', 'completed', 'cancelled'] as const
export type ClassStatus = (typeof CLASS_STATUSES)[number]

export const CLASS_STATUS_ACTIONS = ['open', 'start', 'complete', 'cancel', 'restore'] as const
export type ClassStatusAction = (typeof CLASS_STATUS_ACTIONS)[number]

export const CLASS_TEACHER_ROLES = ['lead', 'assistant'] as const
export type ClassTeacherRole = (typeof CLASS_TEACHER_ROLES)[number]

export const CLASS_SORT_FIELDS = ['code', 'createdAt'] as const
export type ClassSortField = (typeof CLASS_SORT_FIELDS)[number]

/** `ClassCourseDto`: the course a class belongs to (fixed after creation). */
export interface ClassCourse {
  id: string
  code: string
  name: LocalizedLabel
  status: CourseStatus
}

/** `ClassTeacherDto`: lead first, then assistants by assignment time. */
export interface ClassTeacher {
  userId: string
  fullName: string
  role: ClassTeacherRole
  assignedAt: string
}

/** `ClassDto` (API-050..API-054, API-056). */
export interface AcademyClass {
  id: string
  code: string
  name: LocalizedLabel
  capacity: number
  status: ClassStatus
  /** `YYYY-MM-DD`, display only (D-R17). */
  startsOn: string | null
  endsOn: string | null
  notes: string | null
  course: ClassCourse
  teachers: ClassTeacher[]
  /** Active enrollments (computed by the server). */
  enrolledCount: number
  createdAt: string
  updatedAt: string
}

export interface ClassList {
  items: AcademyClass[]
  nextCursor: string | null
}

/** Upper bound of `q` on API-050 (`ListClassesQueryDto`: 1–100 characters after trim). */
export const CLASS_SEARCH_MAX_LENGTH = 100

export interface ListClassesParams {
  /** Code or Arabic/English name substring; at most CLASS_SEARCH_MAX_LENGTH characters. */
  q?: string
  courseId?: string
  status?: ClassStatus
  /** Classes this user teaches (lead or assistant). */
  teacherId?: string
  sort?: ClassSortField
  order?: 'asc' | 'desc'
  /** 1–100, server default 20. */
  limit?: number
  cursor?: string
}

/** Body of API-052 (`CreateClassDto`): the class starts `planned`, for a published course. */
export interface CreateClassInput {
  courseId: string
  code: string
  name: LocalizedLabel
  capacity: number
  startsOn?: string
  endsOn?: string
  notes?: string
}

/** Body of API-053 (`UpdateClassDto`): absent = unchanged, null clears the dates and the notes; the course is fixed. */
export interface UpdateClassInput {
  code?: string
  name?: LocalizedLabel
  capacity?: number
  startsOn?: string | null
  endsOn?: string | null
  notes?: string | null
}

/** Body of API-054: `reason` is recorded in the audit event only. */
export interface ChangeClassStatusInput {
  action: ClassStatusAction
  reason?: string
}

export interface ClassTeacherInput {
  userId: string
  role: ClassTeacherRole
}

/** Body of API-056: the whole final list (`[]` removes every teacher). */
export interface ReplaceClassTeachersInput {
  teachers: ClassTeacherInput[]
}

export const CLASSES_PATH = '/api/classes'

/** `/api/classes?…` with the non-empty parameters only (trimmed search). */
export function classesListPath(params: ListClassesParams = {}): string {
  const query = new URLSearchParams()
  const q = params.q?.trim()
  if (q) query.set('q', q)
  if (params.courseId) query.set('courseId', params.courseId)
  if (params.status) query.set('status', params.status)
  if (params.teacherId) query.set('teacherId', params.teacherId)
  if (params.sort) query.set('sort', params.sort)
  if (params.order) query.set('order', params.order)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${CLASSES_PATH}?${search}` : CLASSES_PATH
}

const classPath = (id: string) => `${CLASSES_PATH}/${encodeURIComponent(id)}`

/** API-050. */
export function listClasses(params: ListClassesParams = {}, signal?: AbortSignal): Promise<ClassList> {
  return apiRequest<ClassList>(classesListPath(params), { signal })
}

/** API-051: 404 `class_not_found` for a class the caller may not see. */
export function getClass(id: string, signal?: AbortSignal): Promise<AcademyClass> {
  return apiRequest<AcademyClass>(classPath(id), { signal })
}

/** API-052. */
export function createClass(input: CreateClassInput): Promise<AcademyClass> {
  return apiRequest<AcademyClass>(CLASSES_PATH, { method: 'POST', body: input })
}

/** API-053. */
export function updateClass(id: string, input: UpdateClassInput): Promise<AcademyClass> {
  return apiRequest<AcademyClass>(classPath(id), { method: 'PATCH', body: input })
}

/** API-054. */
export function changeClassStatus(id: string, input: ChangeClassStatusInput): Promise<AcademyClass> {
  return apiRequest<AcademyClass>(`${classPath(id)}/status`, { method: 'POST', body: input })
}

/** API-055: a planned class without any enrollment (`class_not_deletable` otherwise); resolves on 204. */
export function deleteClass(id: string): Promise<void> {
  return apiRequest<void>(classPath(id), { method: 'DELETE' })
}

/** API-056 (`classes.teachers.assign`): answers with the class and its new teachers. */
export function replaceClassTeachers(id: string, input: ReplaceClassTeachersInput): Promise<AcademyClass> {
  return apiRequest<AcademyClass>(`${classPath(id)}/teachers`, { method: 'PUT', body: input })
}
