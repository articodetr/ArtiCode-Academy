// School subjects (PORTAL-04): GET/POST /api/subjects, PATCH/DELETE
// /api/subjects/:id and PUT /api/subjects/order — an exact mirror of the levels
// API (api/levels.ts, API-037..041) without a description. Types mirror the
// backend's SubjectDto. Reading needs `courses.read` (active subjects only and
// no course count); holders of `courses.manage` read every subject with its
// course count and write them. A subject is the course's school subject
// («المادة»): the levels stay the course's difficulty and the curriculum's
// levels stay `course_sections`.
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

export interface Subject {
  id: string
  code: string
  name: LocalizedLabel
  sortOrder: number
  isActive: boolean
  /** Courses using the subject — for holders of `courses.manage` only (null otherwise). */
  courseCount: number | null
  createdAt: string
  updatedAt: string
}

export interface SubjectList {
  items: Subject[]
}

/** Body of the create call: appended at the end of the order. */
export interface CreateSubjectInput {
  code: string
  name: LocalizedLabel
  isActive?: boolean
}

/** Body of the PATCH: absent = unchanged. */
export interface UpdateSubjectInput {
  code?: string
  name?: LocalizedLabel
  isActive?: boolean
}

export const SUBJECTS_PATH = '/api/subjects'

const subjectPath = (id: string) => `${SUBJECTS_PATH}/${encodeURIComponent(id)}`

/** Active subjects for `courses.read`; every subject with its course count for `courses.manage`. */
export function listSubjects(signal?: AbortSignal): Promise<SubjectList> {
  return apiRequest<SubjectList>(SUBJECTS_PATH, { signal })
}

export function createSubject(input: CreateSubjectInput): Promise<Subject> {
  return apiRequest<Subject>(SUBJECTS_PATH, { method: 'POST', body: input })
}

export function updateSubject(id: string, input: UpdateSubjectInput): Promise<Subject> {
  return apiRequest<Subject>(subjectPath(id), { method: 'PATCH', body: input })
}

/** Refused with `409 subject_in_use { courseCount }` while a course uses the subject; resolves on 204. */
export function deleteSubject(id: string): Promise<void> {
  return apiRequest<void>(subjectPath(id), { method: 'DELETE' })
}

/** The complete new order (every subject exactly once); answers with the reordered list. */
export function reorderSubjects(subjectIds: string[]): Promise<SubjectList> {
  return apiRequest<SubjectList>(`${SUBJECTS_PATH}/order`, { method: 'PUT', body: { subjectIds } })
}
