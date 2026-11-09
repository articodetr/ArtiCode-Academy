// Submissions and review (MOD-08-T03 — J-F41): API-108 GET
// /api/assignments/:id/submissions (the roster), API-109 POST
// /api/assignments/:id/submissions (one attempt of the calling student — its
// screen comes with «my assignments», MOD-08-T04), API-110 GET
// /api/submissions/:id and API-111 POST /api/submissions/:id/review. Types
// mirror backend/src/assignments/submissions.dto.ts field by field; every call
// goes through apiRequest (Bearer header, refresh-and-retry on 401). The roster
// follows the assignment's class visibility (`assignments.read` — D-R16); a
// submission is read by the class's teachers, its student and their guardian
// (no key at the guard — the server decides, 404 otherwise); a review needs
// `assignments.grade` with the class's visibility. Instants are ISO 8601 (UTC);
// neither the roster nor a submission carries the display zone — the screens
// take it from the assignment (API-103 `timeZone`, D-R41).
import { ASSIGNMENTS_PATH } from './assignments'
import type { AssignmentStatus } from './assignments'
import { apiRequest } from './client'
import type { EnrollmentStatus, EnrollmentStudent, MyClassStudent, MyClassTeacher } from './enrollments'
import type { LocalizedLabel } from './users'

/** In the order of the Prisma enum `submission_status`. */
export const SUBMISSION_STATUSES = ['submitted', 'graded', 'returned'] as const
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

/** `grade`: graded with a score · `return`: returned for rework with feedback (submissions.policy.ts). */
export const REVIEW_ACTIONS = ['grade', 'return'] as const
export type ReviewAction = (typeof REVIEW_ACTIONS)[number]

/** Mirrors of the DTO limits (backend/src/assignments/submissions.dto.ts). */
export const TEXT_ANSWER_MAX_LENGTH = 20000
export const LINK_URL_MAX_LENGTH = 2048
export const FEEDBACK_MAX_LENGTH = 2000
/** `score`: a JSON number with at most two decimals (`IsNumber({ maxDecimalPlaces: 2 })`). */
export const SCORE_DECIMAL_PLACES = 2

/** `SubmissionAssignmentDto`: the assignment a submission belongs to, as the roster and a submission carry it. */
export interface SubmissionAssignment {
  id: string
  classId: string
  title: LocalizedLabel
  status: AssignmentStatus
  maxScore: number
  /** ISO 8601 (UTC) or null. */
  dueAt: string | null
}

/** `SubmissionDto` (API-109/API-110/API-111): one attempt, as its student, their guardian and the class's teachers may know it. */
export interface Submission {
  id: string
  assignment: SubmissionAssignment
  /** Identity only (`MyClassStudentDto`) — for every reader. */
  student: MyClassStudent
  attemptNo: number
  /** ISO 8601. */
  submittedAt: string
  /** Submitted after the due date under allowLate — decided by the server. */
  isLate: boolean
  textAnswer: string | null
  linkUrl: string | null
  status: SubmissionStatus
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

/** `SubmissionSummaryDto`: an attempt in the roster — without the answer (read it through API-110). */
export interface SubmissionSummary {
  id: string
  attemptNo: number
  submittedAt: string
  isLate: boolean
  status: SubmissionStatus
  score: number | null
  gradedAt: string | null
}

/** `SubmissionRosterItemDto`: one student of the roster. */
export interface SubmissionRosterItem {
  /** The caller's projection (D-R07): `email`/`username`/`phone` are null without `users.read_contact`. */
  student: EnrollmentStudent
  /** The student's enrollment in the class; a withdrawn student stays listed while they hold a submission. */
  enrollmentStatus: EnrollmentStatus | null
  attempts: number
  attemptsAllowed: number
  /** The latest attempt; null when the student has not submitted. */
  latest: SubmissionSummary | null
  /** The score of the latest graded attempt (what MOD-09 will read — D-R36). */
  lastGradedScore: number | null
}

/** `SubmissionRosterDto` (API-108): every student with an active or completed enrollment, plus anyone holding a submission, in enrollment order. */
export interface SubmissionRoster {
  assignment: SubmissionAssignment
  maxAttempts: number
  items: SubmissionRosterItem[]
}

/** Body of API-109 (`SubmitAssignmentDto`): text and/or an `https://` link (`submission_invalid` without either — D-R35). */
export interface SubmitAssignmentInput {
  textAnswer?: string
  linkUrl?: string | null
}

/**
 * Body of API-111 (`ReviewSubmissionDto`) — the whole new review state (D-R39):
 * `score` goes with `grade` (required) and never with `return`; `feedback`
 * (1–2,000 after trimming) is required with `return`, and with `grade` it
 * replaces the previous feedback — absent clears it.
 */
export interface ReviewSubmissionInput {
  action: ReviewAction
  score?: number
  feedback?: string
}

export const SUBMISSIONS_PATH = '/api/submissions'

/** API-108/API-109 path: the submissions of one assignment. */
export const assignmentSubmissionsPath = (assignmentId: string) => `${ASSIGNMENTS_PATH}/${encodeURIComponent(assignmentId)}/submissions`

export const submissionPath = (submissionId: string) => `${SUBMISSIONS_PATH}/${encodeURIComponent(submissionId)}`

/** API-108: 404 `assignment_not_found` for an assignment of a class the caller may not see. */
export function getSubmissionRoster(assignmentId: string, signal?: AbortSignal): Promise<SubmissionRoster> {
  return apiRequest<SubmissionRoster>(assignmentSubmissionsPath(assignmentId), { signal })
}

/** API-109: one new attempt of the calling student (201). No screen sends it yet — «my assignments» (MOD-08-T04) will. */
export function submitAssignment(assignmentId: string, input: SubmitAssignmentInput): Promise<Submission> {
  return apiRequest<Submission>(assignmentSubmissionsPath(assignmentId), { method: 'POST', body: input })
}

/** API-110: 404 `submission_not_found` for anyone but its student, their guardian and the class's teachers. */
export function getSubmission(submissionId: string, signal?: AbortSignal): Promise<Submission> {
  return apiRequest<Submission>(submissionPath(submissionId), { signal })
}

/** API-111: answers with the submission after the review (an identical review writes nothing and answers the same). */
export function reviewSubmission(submissionId: string, input: ReviewSubmissionInput): Promise<Submission> {
  return apiRequest<Submission>(`${submissionPath(submissionId)}/review`, { method: 'POST', body: input })
}
