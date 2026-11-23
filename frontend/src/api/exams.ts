// Exams (MOD-09-T03 — J-F45): API-113 GET /api/exams, API-114 GET
// /api/exams/:id, API-115 POST /api/classes/:id/exams, API-116 PATCH
// /api/exams/:id, API-117 POST /api/exams/:id/status and API-118 DELETE
// /api/exams/:id. Types mirror backend/src/exams/exams.dto.ts field by field;
// every call goes through apiRequest (Bearer header, refresh-and-retry on 401).
// Reading needs `exams.read` and follows the class visibility (D-R16: a holder
// of `classes.manage` sees every class's exams, anyone else those of the
// classes they teach); writing needs `exams.manage` with the same visibility —
// the server decides. An exam's results are recorded by the teacher (D-R42);
// their sheet is api/examResults.ts. Instants are ISO 8601 in UTC; `timeZone`
// is the zone to show them in (D-R41). Every number is the server's (no grade
// is computed here).
//
// Since MOD-09 phase 2 (roadmap §4r) an exam is `manual` (the default: the
// teacher records the results) or `online` (taken on the platform and graded by
// the server). There is no new status: `schedule` makes an online exam
// available to its learners inside its window (`scheduledAt` opens it,
// `closesAt` closes it, `durationMinutes` is one attempt's time limit) and
// `publish` releases the results, as before. `delivery` changes in a draft
// only; a manual exam carries no online setting (`online_settings_not_allowed`).
// Its questions are api/examQuestions.ts, its attempts api/examAttempts.ts.
import type { AssignmentLesson } from './assignments'
import { CLASSES_PATH } from './classes'
import { apiRequest } from './client'
import type { ScheduleClass } from './timetable'
import type { LocalizedLabel } from './users'

/** In the order of the Prisma enum `exam_status` (D-R47): draft → scheduled (the learners see it) → published (they see their results). */
export const EXAM_STATUSES = ['draft', 'scheduled', 'published'] as const
export type ExamStatus = (typeof EXAM_STATUSES)[number]

/** In the order of the Prisma enum `exam_type` (D-R42 — results recorded by the teacher). */
export const EXAM_TYPES = ['quiz', 'midterm', 'final', 'project', 'oral', 'practice', 'other'] as const
export type ExamType = (typeof EXAM_TYPES)[number]

/** `schedule` draft → scheduled · `unschedule` scheduled → draft · `publish` scheduled → published · `unpublish` published → scheduled (exams.status.ts). */
export const EXAM_STATUS_ACTIONS = ['schedule', 'unschedule', 'publish', 'unpublish'] as const
export type ExamStatusAction = (typeof EXAM_STATUS_ACTIONS)[number]

/** By exam date (undated exams last in both orders), then id. */
export type ExamSortOrder = 'asc' | 'desc'

/** `manual`: the teacher records the results; `online`: taken on the platform and graded by the server (D-R150). */
export const EXAM_DELIVERIES = ['manual', 'online'] as const
export type ExamDelivery = (typeof EXAM_DELIVERIES)[number]

/** When a learner sees their own score: once the teacher publishes, or as soon as their attempt is finished (D-R156). */
export const EXAM_RESULTS_RELEASES = ['on_publish', 'on_submit'] as const
export type ExamResultsRelease = (typeof EXAM_RESULTS_RELEASES)[number]

/** `attemptsAllowed`: a whole number 1..20 (`EXAM_ATTEMPTS_MAX`). */
export const EXAM_ATTEMPTS_MAX = 20

/** Mirrors of the DTO limits (backend/src/exams/exams.dto.ts, roles.dto.ts, assignments.dto.ts). */
export const EXAMS_PAGE_MAX = 100
/** The shared localized-text limit of the title (`LOCALIZED_TEXT_MAX_LENGTH`), per locale. */
export const EXAM_TITLE_MAX_LENGTH = 200
/** The description reuses `AssignmentInstructionsDto` (`INSTRUCTIONS_MAX_LENGTH`), per locale. */
export const EXAM_DESCRIPTION_MAX_LENGTH = 4000
/** `maxScore`: `numeric(6,2)`, at least 0.01 (`EXAM_SCORE_LIMIT`); `passScore` and a result's `score` from 0 up to it. */
export const EXAM_MAX_SCORE_MIN = 0.01
export const EXAM_SCORE_LIMIT = 9999.99
/** `weight`: `numeric(5,2)`, at least 0 (`EXAM_WEIGHT_LIMIT`). */
export const EXAM_WEIGHT_LIMIT = 999.99
/** `durationMinutes`: a whole number 1..720 (CHECK `ck_exams_duration_range`). */
export const EXAM_DURATION_MAX = 720
/** Every decimal travels as a JSON number with at most two decimals. */
export const EXAM_DECIMAL_PLACES = 2
export const EXAM_STATUS_REASON_MAX_LENGTH = 500

/** `AssignmentLessonDto`, which `ExamDto.lesson` reuses: the lesson the exam is held in. */
export type ExamLesson = AssignmentLesson

/** `ExamResultCountsDto`: the recorded results by status (computed by the server, never stored). */
export interface ExamResultCounts {
  /** Students with a recorded result. */
  students: number
  scored: number
  absent: number
  excused: number
}

/** `ExamAttemptCountsDto`: who has taken an online exam. */
export interface ExamAttemptCounts {
  /** Students with at least one attempt. */
  students: number
  inProgress: number
  /** Students with a finished attempt. */
  finished: number
}

/** `ExamOnlineSummaryDto`: the online side of an exam (null for a manual one). */
export interface ExamOnlineSummary {
  questionCount: number
  /** The sum of the linked questions' points; it must equal `maxScore` to make the exam available (D-R159). */
  totalPoints: number
  /** True once the exam is scheduled or published: its questions are frozen copies (D-R158). */
  frozen: boolean
  /** For a draft: what keeps `schedule` from making it available (`EXAM_READINESS_PROBLEMS` in api/examQuestions.ts). Empty otherwise. */
  problems: string[]
  attempts: ExamAttemptCounts
}

/** `ExamDto` (API-113..API-117). */
export interface Exam {
  id: string
  /** The class with its course (`TimetableClassDto`). */
  class: ScheduleClass
  lesson: ExamLesson | null
  title: LocalizedLabel
  description: LocalizedLabel | null
  type: ExamType
  status: ExamStatus
  /** ISO 8601 (UTC) — when the exam takes place; null = not dated yet. */
  scheduledAt: string | null
  durationMinutes: number | null
  /** IANA zone to show the date in: the linked lesson's room branch, else the academy's (D-R41). */
  timeZone: string
  maxScore: number
  /** Informational (passing the course comes from the grade scheme). */
  passScore: number | null
  /** Weight in the final grade (D-R43); null = informational. */
  weight: number | null
  /** ISO 8601; set by `publish`, cleared by `unpublish`. */
  publishedAt: string | null
  delivery: ExamDelivery
  /** ISO 8601 (UTC) — when an online exam's window closes; null for a manual exam and an undated draft. */
  closesAt: string | null
  /** 1..20; always 1 for a manual exam. */
  attemptsAllowed: number
  resultsRelease: ExamResultsRelease
  /** Whether the correct answers are shown with the released result once the window has closed (D-R157). */
  revealAnswers: boolean
  /** Null for a manual exam. */
  online: ExamOnlineSummary | null
  results: ExamResultCounts
  /** Active enrollments of the class — the «total» of «recorded / total». */
  activeStudents: number
  createdAt: string
  updatedAt: string
}

export interface ExamList {
  items: Exam[]
  nextCursor: string | null
}

export interface ListExamsParams {
  /** Part of the Arabic or English title, 1–100 characters (CH-0226). */
  q?: string
  classId?: string
  lessonId?: string
  status?: ExamStatus
  type?: ExamType
  delivery?: ExamDelivery
  /** ISO 8601 instants with an offset or `Z`: exams taking place in `[from, to]` — an undated exam never matches. */
  from?: string
  to?: string
  /** By exam date (undated last), then id; `asc` by default. */
  order?: ExamSortOrder
  /** 1–100, server default 20. */
  limit?: number
  cursor?: string
}

/** Body of API-115 (`CreateExamDto`): the exam starts as a `draft`. */
export interface CreateExamInput {
  title: LocalizedLabel
  description?: LocalizedLabel | null
  type: ExamType
  /** A lesson of the same class (`lesson_mismatch` otherwise). */
  lessonId?: string | null
  /** ISO 8601 instant with an offset; absent or null = not dated yet. */
  scheduledAt?: string | null
  /** A whole number 1..720. */
  durationMinutes?: number | null
  maxScore: number
  /** At most maxScore (`pass_score_invalid`). */
  passScore?: number | null
  weight?: number | null
  /** `manual` by default. The four settings below belong to an online exam only (`online_settings_not_allowed { fields }` otherwise). */
  delivery?: ExamDelivery
  /** ISO 8601 instant with an offset, after `scheduledAt` (`window_invalid`). */
  closesAt?: string | null
  /** A JSON whole number 1..20. */
  attemptsAllowed?: number
  resultsRelease?: ExamResultsRelease
  /** A JSON boolean. */
  revealAnswers?: boolean
}

/**
 * Body of API-116 (`UpdateExamDto`): absent = unchanged, null clears
 * `description`, `lessonId`, `scheduledAt`, `durationMinutes`, `passScore` and
 * `weight`; `title`, `type` and `maxScore` are never null (`maxScore` is locked
 * once a result exists — `exam_locked`). The status moves through API-117.
 * The online fields: `delivery` changes in a draft only; once the learners see
 * an online exam `maxScore` is frozen and its opening, closing and time limit
 * cannot be cleared; once somebody has started, the opening and the time limit
 * are fixed, the closing only moves later and the attempts only rise — all
 * `409 exam_locked { status, fields, resultCount, attemptCount? }`. Turning an
 * online draft manual unlinks its questions.
 */
export interface UpdateExamInput {
  title?: LocalizedLabel
  description?: LocalizedLabel | null
  type?: ExamType
  lessonId?: string | null
  scheduledAt?: string | null
  durationMinutes?: number | null
  maxScore?: number
  passScore?: number | null
  weight?: number | null
  delivery?: ExamDelivery
  /** Null clears it (a draft only). */
  closesAt?: string | null
  attemptsAllowed?: number
  resultsRelease?: ExamResultsRelease
  revealAnswers?: boolean
}

/** Body of API-117: `reason` (1–500 after trimming) is recorded in the audit event only. */
export interface ChangeExamStatusInput {
  action: ExamStatusAction
  reason?: string
}

export const EXAMS_PATH = '/api/exams'

/** `/api/exams?…` with the given parameters only, in a fixed order. */
export function examsListPath(params: ListExamsParams = {}): string {
  const query = new URLSearchParams()
  if (params.q?.trim()) query.set('q', params.q.trim().slice(0, 100))
  if (params.classId) query.set('classId', params.classId)
  if (params.lessonId) query.set('lessonId', params.lessonId)
  if (params.status) query.set('status', params.status)
  if (params.type) query.set('type', params.type)
  if (params.delivery) query.set('delivery', params.delivery)
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.order) query.set('order', params.order)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${EXAMS_PATH}?${search}` : EXAMS_PATH
}

export const examPath = (id: string) => `${EXAMS_PATH}/${encodeURIComponent(id)}`

/** API-115 path: the exams of one class. */
export const classExamsPath = (classId: string) => `${CLASSES_PATH}/${encodeURIComponent(classId)}/exams`

/** API-113. */
export function listExams(params: ListExamsParams = {}, signal?: AbortSignal): Promise<ExamList> {
  return apiRequest<ExamList>(examsListPath(params), { signal })
}

/** API-114: 404 `exam_not_found` for an exam of a class the caller may not see. */
export function getExam(id: string, signal?: AbortSignal): Promise<Exam> {
  return apiRequest<Exam>(examPath(id), { signal })
}

/** API-115: a draft of a planned, open or running class (`class_closed` otherwise). */
export function createExam(classId: string, input: CreateExamInput): Promise<Exam> {
  return apiRequest<Exam>(classExamsPath(classId), { method: 'POST', body: input })
}

/** API-116. */
export function updateExam(id: string, input: UpdateExamInput): Promise<Exam> {
  return apiRequest<Exam>(examPath(id), { method: 'PATCH', body: input })
}

/**
 * API-117. For an online exam: `schedule` needs it ready (409 `exam_not_ready { problems, totalPoints, maxScore, questionIds }`)
 * and freezes its questions; `unschedule` is refused once somebody has started (409 `exam_has_attempts`);
 * `publish` waits for the window to close (409 `exam_window_open { closesAt }`) and first closes any attempt still open.
 */
export function changeExamStatus(id: string, input: ChangeExamStatusInput): Promise<Exam> {
  return apiRequest<Exam>(`${examPath(id)}/status`, { method: 'POST', body: input })
}

/** API-118: a draft or scheduled exam without any result (`exam_not_deletable` otherwise); resolves on 204. */
export function deleteExam(id: string): Promise<void> {
  return apiRequest<void>(examPath(id), { method: 'DELETE' })
}
