// «My assignments» (MOD-08-T04 — J-F42): API-112 GET /api/me/assignments, and
// the learner's two submission calls of MOD-08-T03: API-109 POST
// /api/assignments/:id/submissions (one attempt of the calling student) and
// API-110 GET /api/submissions/:id (one attempt, read by its student or their
// guardian). Types mirror backend/src/assignments/my-assignments.dto.ts and the
// learner's part of submissions.dto.ts field by field; the teachers' roster and
// review live in api/submissions.ts (J-F41) — the two mirror SubmissionDto
// separately until one of them imports the other. Every call goes through
// apiRequest (Bearer header, refresh-and-retry on 401).
//
// Ownership, no permission key at the list (D-R40): the open and closed
// assignments — never drafts — of the classes the caller is enrolled in,
// `active` or `completed` (`relation: self`), and, while the caller holds the
// `guardian` role, those of their linked children's classes (`relation:
// child`). One item per assignment × student, so a guardian with two children
// in one class gets each assignment twice; `limit` counts assignments. Each
// item carries what a learner may know — the assignment with its instructions
// and grading rules (learners never read API-103), the class and course, the
// linked lesson, that student's attempt counts and the review of their latest
// attempt — never the weight, the reviewer, the answer or anyone else's
// attempt. Submitting needs `assignments.submit` and an `active` enrollment;
// reading a submission needs nothing at the guard (the server answers 404 to
// anyone but its student, their guardian and the class's teachers).
import { ASSIGNMENTS_PATH } from './assignments'
import type { AssignmentLesson, AssignmentSortOrder, AssignmentStatus } from './assignments'
import { apiRequest } from './client'
import type { MyClassRelation, MyClassStudent, MyClassTeacher } from './enrollments'
import type { ScheduleClass } from './timetable'
import type { LocalizedLabel } from './users'

/** The statuses a learner sees (`MY_ASSIGNMENT_STATUSES` of my-assignments.policy.ts): drafts are the teacher's (D-R37). */
export const MY_ASSIGNMENT_STATUSES = ['open', 'closed'] as const
export type MyAssignmentStatus = (typeof MY_ASSIGNMENT_STATUSES)[number]

/** The status of one attempt, in the order of the Prisma enum `submission_status`. */
export const MY_SUBMISSION_STATUSES = ['submitted', 'graded', 'returned'] as const
export type MySubmissionStatus = (typeof MY_SUBMISSION_STATUSES)[number]

/** Mirrors of `TEXT_ANSWER_MAX_LENGTH`, `LINK_URL_MAX_LENGTH` and `LINK_URL_PATTERN` (submissions.dto.ts). */
export const SUBMIT_TEXT_MAX_LENGTH = 20000
export const SUBMIT_LINK_MAX_LENGTH = 2048
/** `https://` and no whitespace (the CHECK `ck_assignment_submissions_link_url_https` is the server's backstop). */
export const SUBMIT_LINK_PATTERN = /^https:\/\/\S+$/

/** `MyAssignmentLatestDto`: the student's latest attempt — its review, never the reviewer or the answer (read through API-110). */
export interface MyAssignmentLatest {
  /** The submission — the id API-110 reads. */
  id: string
  attemptNo: number
  /** ISO 8601. */
  submittedAt: string
  /** Submitted after the due date under allowLate — decided by the server. */
  isLate: boolean
  status: MySubmissionStatus
  /** With `graded` only. */
  score: number | null
  /** The teacher's feedback to the student (mandatory on a returned attempt). */
  feedback: string | null
  /** ISO 8601 — the last review (graded or returned), or null. */
  gradedAt: string | null
}

/** `MyAssignmentItemDto`: one assignment the caller owns through one student. */
export interface MyAssignmentItem {
  /** The assignment (repeated when the caller owns it through several students — key rows by assignment AND student). */
  id: string
  title: LocalizedLabel
  instructions: LocalizedLabel | null
  status: MyAssignmentStatus
  maxScore: number
  /** ISO 8601 (UTC) or null = no due date. */
  dueAt: string | null
  /** IANA zone to show the due date in: the linked lesson's room branch, else the academy's (D-R41). */
  timeZone: string
  allowLate: boolean
  /** Kept for the grades module (D-R36): nothing is deducted here. */
  latePenaltyPercent: number | null
  maxAttempts: number
  /** ISO 8601. */
  publishedAt: string | null
  /** ISO 8601 or null. */
  closedAt: string | null
  lesson: AssignmentLesson | null
  /** `TimetableClassDto` — the class with its course. */
  class: ScheduleClass
  relation: MyClassRelation
  /** The enrolled student the item is about (identity only). */
  student: MyClassStudent
  /** That student's attempts. */
  attempts: number
  /** maxAttempts plus one per returned attempt (D-R39). */
  attemptsAllowed: number
  /** That student's latest attempt; null before the first submission. */
  latest: MyAssignmentLatest | null
}

export interface MyAssignmentList {
  /** By due date (undated last), then id; inside one assignment `self` before `child`, then the student's id. */
  items: MyAssignmentItem[]
  /** Cursor of the next page of assignments; null on the last page. */
  nextCursor: string | null
}

export interface ListMyAssignmentsParams {
  /** Assignments of this class only (a class the caller does not own matches nothing). */
  classId?: string
  /** Assignments owned through this student only — the caller or one of their children (anyone else matches nothing). */
  studentId?: string
  status?: MyAssignmentStatus
  /** true: only the items of a student who has not submitted yet (a returned attempt counts as submitted); false = absent. */
  pending?: boolean
  /** ISO 8601 instants with an offset or `Z`: assignments due in `[dueFrom, dueTo]` — one without a due date never matches. */
  dueFrom?: string
  dueTo?: string
  /** By due date (none last), then id; `asc` by default. */
  order?: AssignmentSortOrder
  /** Assignments per page, 1–100 (server default 20). */
  limit?: number
  /** Opaque `nextCursor`; send it with the same filters and order. */
  cursor?: string
}

/** `SubmissionAssignmentDto`: the assignment an attempt belongs to, as the server holds it now. */
export interface MySubmissionAssignment {
  id: string
  classId: string
  title: LocalizedLabel
  status: AssignmentStatus
  maxScore: number
  /** ISO 8601 (UTC) or null. */
  dueAt: string | null
}

/** `SubmissionDto` (API-109/API-110) as its student and their guardian read it. */
export interface MySubmission {
  id: string
  assignment: MySubmissionAssignment
  /** Identity only. */
  student: MyClassStudent
  attemptNo: number
  /** ISO 8601. */
  submittedAt: string
  isLate: boolean
  textAnswer: string | null
  linkUrl: string | null
  status: MySubmissionStatus
  /** With `graded` only. */
  score: number | null
  feedback: string | null
  /** Who reviewed it, by name only; null before a review or when that account was deleted. */
  gradedBy: MyClassTeacher | null
  /** ISO 8601 — the last review (graded or returned). */
  gradedAt: string | null
  /** The student's attempts on this assignment. */
  attempts: number
  /** maxAttempts plus one per returned attempt (D-R39). */
  attemptsAllowed: number
}

/**
 * Body of API-109 (`SubmitAssignmentDto`): text and/or an `https://` link
 * (`submission_invalid` without either — D-R35); the server trims both and
 * treats a blank one as absent. The screen sends only what was typed.
 */
export interface MySubmitInput {
  textAnswer?: string
  linkUrl?: string
}

export const MY_ASSIGNMENTS_PATH = '/api/me/assignments'

/** `/api/me/assignments?…` with the given parameters only, in a fixed order (URLSearchParams encodes the `+` of an offset). */
export function myAssignmentsPath(params: ListMyAssignmentsParams = {}): string {
  const query = new URLSearchParams()
  if (params.classId) query.set('classId', params.classId)
  if (params.studentId) query.set('studentId', params.studentId)
  if (params.status) query.set('status', params.status)
  if (params.pending === true) query.set('pending', 'true')
  if (params.dueFrom) query.set('dueFrom', params.dueFrom)
  if (params.dueTo) query.set('dueTo', params.dueTo)
  if (params.order) query.set('order', params.order)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${MY_ASSIGNMENTS_PATH}?${search}` : MY_ASSIGNMENTS_PATH
}

/** API-109 path: the attempts of one assignment. */
export const submitAttemptPath = (assignmentId: string) => `${ASSIGNMENTS_PATH}/${encodeURIComponent(assignmentId)}/submissions`

/** API-110 path. */
export const mySubmissionPath = (submissionId: string) => `/api/submissions/${encodeURIComponent(submissionId)}`

/** API-112 (no permission key — ownership): 400 on a malformed filter or `cursor_invalid`. */
export function listMyAssignments(params: ListMyAssignmentsParams = {}, signal?: AbortSignal): Promise<MyAssignmentList> {
  return apiRequest<MyAssignmentList>(myAssignmentsPath(params), { signal })
}

/**
 * API-109: one new attempt of the calling student (201 with the attempt and
 * the student's new counts). 400 `submission_invalid`, 403 `not_enrolled` /
 * `permission_denied`, 404 `assignment_not_found`, 409 `assignment_closed`
 * `{ reason }` / `attempts_exhausted` `{ maxAttempts, attempts }`.
 */
export function submitMyAttempt(assignmentId: string, input: MySubmitInput): Promise<MySubmission> {
  return apiRequest<MySubmission>(submitAttemptPath(assignmentId), { method: 'POST', body: input })
}

/** API-110: 404 `submission_not_found` for anyone but its student, their guardian and the class's teachers. */
export function getMySubmission(submissionId: string, signal?: AbortSignal): Promise<MySubmission> {
  return apiRequest<MySubmission>(mySubmissionPath(submissionId), { signal })
}
