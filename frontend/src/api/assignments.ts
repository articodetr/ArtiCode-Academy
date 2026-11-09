// Assignments (MOD-08-T02 — J-F38): API-102 GET /api/assignments, API-103 GET
// /api/assignments/:id, API-104 POST /api/classes/:id/assignments, API-105 PATCH
// /api/assignments/:id, API-106 POST /api/assignments/:id/status and API-107
// DELETE /api/assignments/:id. Types mirror backend/src/assignments/
// assignments.dto.ts field by field; every call goes through apiRequest (Bearer
// header, refresh-and-retry on 401). Reading needs `assignments.read` and
// follows the class visibility (D-R16: a holder of `classes.manage` sees every
// class's assignments, anyone else those of the classes they teach); writing
// needs `assignments.manage` with the same visibility — the server decides.
// Instants are ISO 8601 in UTC; `timeZone` is the zone to show them in (D-R41).
import { CLASSES_PATH } from './classes'
import { apiRequest } from './client'
import type { ScheduleClass } from './timetable'
import type { LocalizedLabel } from './users'

/** In the order of the Prisma enum `assignment_status`; `grading`/`graded` are unused in the first version (D-R37). */
export const ASSIGNMENT_STATUSES = ['draft', 'open', 'closed', 'grading', 'graded'] as const
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]

/** `publish` draft → open · `close` open → closed · `reopen` closed → open (assignments.status.ts). */
export const ASSIGNMENT_STATUS_ACTIONS = ['publish', 'close', 'reopen'] as const
export type AssignmentStatusAction = (typeof ASSIGNMENT_STATUS_ACTIONS)[number]

/** By due date (assignments without one last in both orders), then id. */
export type AssignmentSortOrder = 'asc' | 'desc'

/** Mirrors of the DTO limits (backend/src/assignments/assignments.dto.ts, roles.dto.ts). */
export const ASSIGNMENTS_PAGE_MAX = 100
/** The shared localized-text limit of the title (`LOCALIZED_TEXT_MAX_LENGTH`), per locale. */
export const ASSIGNMENT_TITLE_MAX_LENGTH = 200
/** `INSTRUCTIONS_MAX_LENGTH`, per locale. */
export const ASSIGNMENT_INSTRUCTIONS_MAX_LENGTH = 4000
/** `maxScore`: `numeric(6,2)`, at least 0.01. */
export const MAX_SCORE_MIN = 0.01
export const MAX_SCORE_LIMIT = 9999.99
/** `weight`: `numeric(5,2)`, at least 0. */
export const WEIGHT_LIMIT = 999.99
/** `latePenaltyPercent`: 0..100. */
export const LATE_PENALTY_LIMIT = 100
/** Every decimal travels as a JSON number with at most two decimals. */
export const ASSIGNMENT_DECIMAL_PLACES = 2
export const MAX_ATTEMPTS_LIMIT = 20
/** The server's default of `maxAttempts`. */
export const DEFAULT_MAX_ATTEMPTS = 1
export const ASSIGNMENT_STATUS_REASON_MAX_LENGTH = 500

/** `AssignmentLessonDto`: the linked lesson, if any. */
export interface AssignmentLesson {
  id: string
  title: LocalizedLabel
  /** ISO 8601 (UTC). */
  startsAt: string
}

/** `SubmissionCountsDto`: the students' latest attempts by status (computed by the server). */
export interface SubmissionCounts {
  /** Students with at least one submission. */
  students: number
  /** Students whose latest attempt waits for review. */
  submitted: number
  /** Students whose latest attempt is graded. */
  graded: number
  /** Students whose latest attempt was returned for rework. */
  returned: number
}

/** `AssignmentDto` (API-102..API-106). */
export interface Assignment {
  id: string
  /** The class with its course (`TimetableClassDto`). */
  class: ScheduleClass
  lesson: AssignmentLesson | null
  title: LocalizedLabel
  instructions: LocalizedLabel | null
  maxScore: number
  weight: number | null
  status: AssignmentStatus
  /** ISO 8601; set by `publish`. */
  publishedAt: string | null
  /** ISO 8601; set by `close`, cleared by `reopen`. */
  closedAt: string | null
  /** ISO 8601 (UTC) or null = no due date. */
  dueAt: string | null
  /** IANA zone to show the due date in: the linked lesson's room branch, else the academy's (D-R41). */
  timeZone: string
  allowLate: boolean
  latePenaltyPercent: number | null
  maxAttempts: number
  submissions: SubmissionCounts
  /** Active enrollments of the class — the «total» of «submitted / total». */
  activeStudents: number
  createdAt: string
  updatedAt: string
}

export interface AssignmentList {
  items: Assignment[]
  nextCursor: string | null
}

export interface ListAssignmentsParams {
  classId?: string
  lessonId?: string
  status?: AssignmentStatus
  /** ISO 8601 instants with an offset or `Z`: assignments due in `[dueFrom, dueTo]` — one without a due date never matches. */
  dueFrom?: string
  dueTo?: string
  /** By due date (none last), then id; `asc` by default. */
  order?: AssignmentSortOrder
  /** 1–100, server default 20. */
  limit?: number
  cursor?: string
}

/** Body of API-104 (`CreateAssignmentDto`): the assignment starts as a `draft`. */
export interface CreateAssignmentInput {
  title: LocalizedLabel
  instructions?: LocalizedLabel | null
  /** A lesson of the same class (`lesson_mismatch` otherwise). */
  lessonId?: string | null
  maxScore: number
  weight?: number | null
  /** ISO 8601 instant with an offset; absent or null = no due date (the past is accepted). */
  dueAt?: string | null
  /** Server default false. */
  allowLate?: boolean
  /** Needs `allowLate` (`late_penalty_invalid`). */
  latePenaltyPercent?: number | null
  /** Server default 1. */
  maxAttempts?: number
}

/**
 * Body of API-105 (`UpdateAssignmentDto`): absent = unchanged, null clears
 * `instructions`, `lessonId`, `weight`, `dueAt` and `latePenaltyPercent`;
 * `title`, `maxScore`, `allowLate` and `maxAttempts` are never null. The status
 * moves through API-106.
 */
export interface UpdateAssignmentInput {
  title?: LocalizedLabel
  instructions?: LocalizedLabel | null
  lessonId?: string | null
  maxScore?: number
  weight?: number | null
  dueAt?: string | null
  allowLate?: boolean
  latePenaltyPercent?: number | null
  maxAttempts?: number
}

/** Body of API-106: `reason` (1–500 after trimming) is recorded in the audit event only. */
export interface ChangeAssignmentStatusInput {
  action: AssignmentStatusAction
  reason?: string
}

export const ASSIGNMENTS_PATH = '/api/assignments'

/** `/api/assignments?…` with the given parameters only, in a fixed order. */
export function assignmentsListPath(params: ListAssignmentsParams = {}): string {
  const query = new URLSearchParams()
  if (params.classId) query.set('classId', params.classId)
  if (params.lessonId) query.set('lessonId', params.lessonId)
  if (params.status) query.set('status', params.status)
  if (params.dueFrom) query.set('dueFrom', params.dueFrom)
  if (params.dueTo) query.set('dueTo', params.dueTo)
  if (params.order) query.set('order', params.order)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${ASSIGNMENTS_PATH}?${search}` : ASSIGNMENTS_PATH
}

export const assignmentPath = (id: string) => `${ASSIGNMENTS_PATH}/${encodeURIComponent(id)}`

/** API-104 path: the assignments of one class. */
export const classAssignmentsPath = (classId: string) => `${CLASSES_PATH}/${encodeURIComponent(classId)}/assignments`

/** API-102. */
export function listAssignments(params: ListAssignmentsParams = {}, signal?: AbortSignal): Promise<AssignmentList> {
  return apiRequest<AssignmentList>(assignmentsListPath(params), { signal })
}

/** API-103: 404 `assignment_not_found` for an assignment of a class the caller may not see. */
export function getAssignment(id: string, signal?: AbortSignal): Promise<Assignment> {
  return apiRequest<Assignment>(assignmentPath(id), { signal })
}

/** API-104: a draft of a planned, open or running class (`class_closed` otherwise). */
export function createAssignment(classId: string, input: CreateAssignmentInput): Promise<Assignment> {
  return apiRequest<Assignment>(classAssignmentsPath(classId), { method: 'POST', body: input })
}

/** API-105. */
export function updateAssignment(id: string, input: UpdateAssignmentInput): Promise<Assignment> {
  return apiRequest<Assignment>(assignmentPath(id), { method: 'PATCH', body: input })
}

/** API-106. */
export function changeAssignmentStatus(id: string, input: ChangeAssignmentStatusInput): Promise<Assignment> {
  return apiRequest<Assignment>(`${assignmentPath(id)}/status`, { method: 'POST', body: input })
}

/** API-107: a draft without any submission (`assignment_not_deletable` otherwise); resolves on 204. */
export function deleteAssignment(id: string): Promise<void> {
  return apiRequest<void>(assignmentPath(id), { method: 'DELETE' })
}
