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
  classId?: string
  lessonId?: string
  status?: ExamStatus
  type?: ExamType
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
}

/**
 * Body of API-116 (`UpdateExamDto`): absent = unchanged, null clears
 * `description`, `lessonId`, `scheduledAt`, `durationMinutes`, `passScore` and
 * `weight`; `title`, `type` and `maxScore` are never null (`maxScore` is locked
 * once a result exists — `exam_locked`). The status moves through API-117.
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
  if (params.classId) query.set('classId', params.classId)
  if (params.lessonId) query.set('lessonId', params.lessonId)
  if (params.status) query.set('status', params.status)
  if (params.type) query.set('type', params.type)
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

/** API-117. */
export function changeExamStatus(id: string, input: ChangeExamStatusInput): Promise<Exam> {
  return apiRequest<Exam>(`${examPath(id)}/status`, { method: 'POST', body: input })
}

/** API-118: a draft or scheduled exam without any result (`exam_not_deletable` otherwise); resolves on 204. */
export function deleteExam(id: string): Promise<void> {
  return apiRequest<void>(examPath(id), { method: 'DELETE' })
}
