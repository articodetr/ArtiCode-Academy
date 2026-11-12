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
import { apiRequest } from './client'
import type { MyClassRelation, MyClassStudent } from './enrollments'
import type { ExamResultStatus } from './examResults'
import type { ExamLesson, ExamSortOrder, ExamType } from './exams'
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

/** `MyExamItemDto`: one exam the caller owns through one student. */
export interface MyExamItem {
  /** The exam (repeated when the caller owns it through several students — key rows by exam AND student). */
  id: string
  title: LocalizedLabel
  description: LocalizedLabel | null
  type: ExamType
  /** `scheduled`: announced; `published`: the results are out. */
  status: MyExamStatus
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
  /** That student's own result once the results are published; null before, or without a result. */
  result: MyExamResult | null
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
