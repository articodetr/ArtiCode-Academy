// «My exams» (MOD-09-T04 — J-F50): API-121 GET /api/me/exams. Types mirror
// backend/src/exams/my-exams.dto.ts field by field; the call goes through
// apiRequest (Bearer header, refresh-and-retry on 401).
//
// Ownership, no permission key (D-R48, as «my assignments» — D-R40): the
// scheduled and published exams — never drafts (D-R47) — of the classes the
// caller is enrolled in, `active` or `completed` (`relation: self`), and,
// while the caller holds the `guardian` role, those of their linked
// children's classes (`relation: child`). One item per exam × student, so a
// guardian with two children in one class gets each exam twice; `limit`
// counts exams. Each item carries what a learner may know — the exam with its
// date, duration and display zone (D-R41), its maximum and informational pass
// score, the class and course, the linked lesson — and that student's own
// result once the results are published (`visibleResult()` of
// my-exams.policy.ts: the server does not even read an unpublished result) —
// never the weight (the final grade explains it in «my grades», API-129), the
// recorder or anyone else's result. Every number is the server's.
//
// Since MOD-09 phase 2 (roadmap §4r) each item names the exam's `delivery`
// and, for an online exam, its `online` side for that student at the server
// clock: whether an attempt can be started or resumed now (`canStart` — the
// same rule the start route enforces) and why not (`blocker`), the attempt in
// progress and the student's attempts. A result shows once it is RELEASED:
// the exam is published, or it is online and releases on submit (D-R156).
// Never a question or a key — the questions are served by the attempt alone
// (api/myAttempts.ts).
import { apiRequest } from './client'
import type { MyClassRelation, MyClassStudent } from './enrollments'
import type { ExamResultStatus } from './examResults'
import type { ExamDelivery, ExamLesson, ExamResultsRelease, ExamSortOrder, ExamType } from './exams'
import type { AttemptSummary } from './myAttempts'
import type { ScheduleClass } from './timetable'
import type { LocalizedLabel } from './users'

/** The statuses a learner sees (`MY_EXAM_STATUSES` of my-exams.policy.ts — keep in sync): a draft is the teacher's (D-R47). */
export const MY_EXAM_STATUSES = ['scheduled', 'published'] as const
export type MyExamStatus = (typeof MY_EXAM_STATUSES)[number]

/** `MyExamResultDto`: the student's own result — sent for a published exam only. */
export interface MyExamResult {
  status: ExamResultStatus
  /** With `scored` only. */
  score: number | null
  /** The teacher's feedback to the student. */
  feedback: string | null
}

/**
 * Why the exam cannot be taken now, in the server's order (`TAKE_BLOCKERS` of attempts.policy.ts — keep in sync):
 * a guardian's item · no `exams.take` · the results are out · the enrollment is not `active` · a cancelled class ·
 * before the window · after it · no attempt left.
 */
export const TAKE_BLOCKERS = ['not_self', 'not_permitted', 'results_published', 'not_enrolled', 'class_closed', 'not_open_yet', 'closed', 'attempts_exhausted'] as const
export type TakeBlocker = (typeof TAKE_BLOCKERS)[number]

/** `MyExamInProgressDto`: the attempt to resume. */
export interface MyExamInProgress {
  id: string
  attemptNo: number
  /** The server's deadline. */
  expiresAt: string
  /** Whole seconds left at `serverNow`. */
  remainingSeconds: number
}

/** `MyExamOnlineDto`: the online side of an exam for one student, computed at the server clock. */
export interface MyExamOnline {
  /** When the window closes (`scheduledAt` of the item is when it opens). */
  closesAt: string | null
  attemptsAllowed: number
  /** Attempts the student has started, whatever their state. */
  attemptsUsed: number
  questionCount: number
  resultsRelease: ExamResultsRelease
  revealAnswers: boolean
  /** True when the student may start a new attempt or resume the one in progress now; always false on a `child` item. */
  canStart: boolean
  blocker: TakeBlocker | null
  /** The attempt in progress whose deadline has not passed. */
  inProgress: MyExamInProgress | null
  /** The student's attempts in order; a score only once the result is released. */
  attempts: AttemptSummary[]
  /** The server clock this state was computed at. */
  serverNow: string
}

/** `MyExamItemDto`: one exam the caller owns through one student. */
export interface MyExamItem {
  /** The exam (repeated when the caller owns it through several students — key rows by exam AND student). */
  id: string
  title: LocalizedLabel
  description: LocalizedLabel | null
  type: ExamType
  /** `scheduled`: announced — an online exam is taken inside its window; `published`: the results are out. */
  status: MyExamStatus
  delivery: ExamDelivery
  /** ISO 8601 (UTC); null = not dated yet. */
  scheduledAt: string | null
  durationMinutes: number | null
  /** IANA zone to show the date in: the linked lesson's room branch, else the academy's (D-R41). */
  timeZone: string
  maxScore: number
  /** Informational (passing the course comes from the grade scheme). */
  passScore: number | null
  /** ISO 8601 — when the results were published. */
  publishedAt: string | null
  lesson: ExamLesson | null
  /** `TimetableClassDto` — the class with its course. */
  class: ScheduleClass
  relation: MyClassRelation
  /** The enrolled student the item is about (identity only). */
  student: MyClassStudent
  /** That student's own result once it is released (published, or online and released on submit); null before, or without a result. */
  result: MyExamResult | null
  /** The online side of the exam for this student; null for a manual exam. */
  online: MyExamOnline | null
}

export interface MyExamList {
  /** By exam date (undated last), then id; inside one exam `self` before `child`, then the student's id. */
  items: MyExamItem[]
  /** Cursor of the next page of exams; null on the last page. */
  nextCursor: string | null
}

export interface ListMyExamsParams {
  /** Exams of this class only (a class the caller does not own matches nothing). */
  classId?: string
  /** Exams owned through this student only — the caller or one of their children (anyone else matches nothing). */
  studentId?: string
  /** `scheduled` or `published` only (a draft filter is a 400). */
  status?: MyExamStatus
  /** ISO 8601 instants with an offset or `Z`: exams taking place in `[from, to]` — an undated exam never matches. */
  from?: string
  to?: string
  /** By exam date (undated last), then id; `asc` by default. */
  order?: ExamSortOrder
  /** Exams per page, 1–100 (server default 20). */
  limit?: number
  /** Opaque `nextCursor`; send it with the same filters and order. */
  cursor?: string
}

export const MY_EXAMS_PATH = '/api/me/exams'

/** `/api/me/exams?…` with the given parameters only, in a fixed order (URLSearchParams encodes the `+` of an offset). */
export function myExamsPath(params: ListMyExamsParams = {}): string {
  const query = new URLSearchParams()
  if (params.classId) query.set('classId', params.classId)
  if (params.studentId) query.set('studentId', params.studentId)
  if (params.status) query.set('status', params.status)
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.order) query.set('order', params.order)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${MY_EXAMS_PATH}?${search}` : MY_EXAMS_PATH
}

/** API-121 (no permission key — ownership): 400 on a malformed filter or `cursor_invalid`. */
export function listMyExams(params: ListMyExamsParams = {}, signal?: AbortSignal): Promise<MyExamList> {
  return apiRequest<MyExamList>(myExamsPath(params), { signal })
}
