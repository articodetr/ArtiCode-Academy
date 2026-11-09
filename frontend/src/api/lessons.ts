// Lessons (MOD-06-T02 — J-F09): API-093 GET /api/lessons, API-094 GET
// /api/lessons/:id, API-095 POST /api/classes/:id/lessons, API-096 PATCH
// /api/lessons/:id, API-097 POST /api/lessons/:id/status and API-098 DELETE
// /api/lessons/:id. Types mirror backend/src/lessons/lessons.dto.ts; every call
// goes through apiRequest (Bearer header, refresh-and-retry on 401). Reading
// needs `lessons.read` and follows the class visibility (D-R16/D-R32: a
// holder of `classes.manage` sees every lesson, anyone else the lessons of
// the classes they teach); writing needs `lessons.manage` with the same
// visibility — the server decides. Instants are ISO 8601 in UTC; each lesson
// names the IANA zone it is shown in (`timeZone` — D-R41).
import { CLASSES_PATH } from './classes'
import { apiRequest } from './client'
import type { ScheduleClass, ScheduleRoom, ScheduleTeacher } from './timetable'
import type { LocalizedLabel } from './users'

export const LESSON_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const
export type LessonStatus = (typeof LESSON_STATUSES)[number]

/** In the order of the Prisma enum `delivery_mode`; `in_person` is the server default. */
export const DELIVERY_MODES = ['in_person', 'live_online', 'recorded', 'hybrid'] as const
export type DeliveryMode = (typeof DELIVERY_MODES)[number]

/** `complete` scheduled → completed (once started) · `cancel` scheduled → cancelled · `restore` cancelled → scheduled. */
export const LESSON_STATUS_ACTIONS = ['complete', 'cancel', 'restore'] as const
export type LessonStatusAction = (typeof LESSON_STATUS_ACTIONS)[number]

export type LessonSortOrder = 'asc' | 'desc'

/** Mirrors of the DTO limits (backend/src/lessons/lessons.dto.ts, lessons.time.ts). */
export const LESSONS_PAGE_MAX = 100
export const MAX_LESSON_HOURS = 12
export const MEETING_URL_MAX_LENGTH = 2048
/** `https://` and no whitespace. */
export const MEETING_URL_PATTERN = /^https:\/\/\S+$/
export const LESSON_STATUS_REASON_MAX_LENGTH = 500
export const LESSON_TEXT_MAX_LENGTH = 200

/** `LessonSyllabusItemDto`: the syllabus item of the class's course the lesson covers. */
export interface LessonSyllabusItem {
  id: string
  sortOrder: number
  title: LocalizedLabel
}

/** `AttendanceCountsDto`: attendance records of the lesson by status (computed by the server). */
export interface AttendanceCounts {
  recorded: number
  present: number
  absent: number
  late: number
  excused: number
}

/** `LessonDto` (API-093..API-097). */
export interface Lesson {
  id: string
  /** The class with its course (`TimetableClassDto`). */
  class: ScheduleClass
  title: LocalizedLabel
  description: LocalizedLabel | null
  deliveryMode: DeliveryMode
  /** ISO 8601 (UTC). */
  startsAt: string
  endsAt: string
  status: LessonStatus
  room: ScheduleRoom | null
  /**
   * IANA zone the lesson is displayed in: the room's branch when it has one,
   * else the academy's (D-R41 — as `timeZone` in API-090/091). The screens show
   * and take its times in this zone (J-F28).
   */
  timeZone: string
  /** The lesson's own teacher (a snapshot — D-R33 (3)); null = none. */
  teacher: ScheduleTeacher | null
  syllabusItem: LessonSyllabusItem | null
  /** The weekly slot the lesson was generated from (MOD-07-T05); null when created by hand. */
  scheduleId: string | null
  meetingUrl: string | null
  /** Set by `cancel`, cleared by `restore`. */
  cancellationReason: string | null
  /** ISO 8601; set when attendance is first recorded (MOD-06-T03). */
  attendanceTakenAt: string | null
  attendance: AttendanceCounts
  createdAt: string
  updatedAt: string
}

export interface LessonList {
  items: Lesson[]
  nextCursor: string | null
}

export interface ListLessonsParams {
  classId?: string
  /** Lessons assigned to this teacher (a lesson without a teacher never matches). */
  teacherId?: string
  status?: LessonStatus
  /** ISO 8601 instants with an offset or `Z`: lessons starting in `[from, to]`. */
  from?: string
  to?: string
  /** By start time, then id; `asc` by default. */
  order?: LessonSortOrder
  /** 1–100, server default 20. */
  limit?: number
  cursor?: string
}

/** Body of API-095 (`CreateLessonDto`): `teacherUserId` absent = the class's lead teacher at creation, null = no teacher. */
export interface CreateLessonInput {
  title: LocalizedLabel
  description?: LocalizedLabel | null
  deliveryMode?: DeliveryMode
  startsAt: string
  endsAt: string
  roomId?: string | null
  teacherUserId?: string | null
  syllabusItemId?: string | null
  meetingUrl?: string | null
}

/** Body of API-096 (`UpdateLessonDto`): absent = unchanged, null clears the optional links; the status moves through API-097. */
export interface UpdateLessonInput {
  title?: LocalizedLabel
  description?: LocalizedLabel | null
  deliveryMode?: DeliveryMode
  startsAt?: string
  endsAt?: string
  roomId?: string | null
  teacherUserId?: string | null
  syllabusItemId?: string | null
  meetingUrl?: string | null
}

/** Body of API-097: `reason` is stored as `cancellationReason` for `cancel` and recorded in the audit event. */
export interface ChangeLessonStatusInput {
  action: LessonStatusAction
  reason?: string
}

export const LESSONS_PATH = '/api/lessons'

/** `/api/lessons?…` with the given parameters only, in a fixed order. */
export function lessonsListPath(params: ListLessonsParams = {}): string {
  const query = new URLSearchParams()
  if (params.classId) query.set('classId', params.classId)
  if (params.teacherId) query.set('teacherId', params.teacherId)
  if (params.status) query.set('status', params.status)
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.order) query.set('order', params.order)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${LESSONS_PATH}?${search}` : LESSONS_PATH
}

const lessonPath = (id: string) => `${LESSONS_PATH}/${encodeURIComponent(id)}`

/** API-095 path: the lessons of one class. */
export const classLessonsPath = (classId: string) => `${CLASSES_PATH}/${encodeURIComponent(classId)}/lessons`

/** API-093. */
export function listLessons(params: ListLessonsParams = {}, signal?: AbortSignal): Promise<LessonList> {
  return apiRequest<LessonList>(lessonsListPath(params), { signal })
}

/** API-094: 404 `lesson_not_found` for a lesson of a class the caller may not see. */
export function getLesson(id: string, signal?: AbortSignal): Promise<Lesson> {
  return apiRequest<Lesson>(lessonPath(id), { signal })
}

/** API-095: a scheduled lesson of a planned, open or running class (`class_closed` otherwise). */
export function createLesson(classId: string, input: CreateLessonInput): Promise<Lesson> {
  return apiRequest<Lesson>(classLessonsPath(classId), { method: 'POST', body: input })
}

/** API-096. */
export function updateLesson(id: string, input: UpdateLessonInput): Promise<Lesson> {
  return apiRequest<Lesson>(lessonPath(id), { method: 'PATCH', body: input })
}

/** API-097. */
export function changeLessonStatus(id: string, input: ChangeLessonStatusInput): Promise<Lesson> {
  return apiRequest<Lesson>(`${lessonPath(id)}/status`, { method: 'POST', body: input })
}

/** API-098: a scheduled lesson without any attendance record (`lesson_not_deletable` otherwise); resolves on 204. */
export function deleteLesson(id: string): Promise<void> {
  return apiRequest<void>(lessonPath(id), { method: 'DELETE' })
}
