// «My lessons» (MOD-06-T04 — J-F11): API-101 GET /api/me/lessons. Types mirror
// backend/src/lessons/my-lessons.dto.ts; the call goes through apiRequest
// (Bearer header, refresh-and-retry on 401). Ownership, no permission key
// (D-R32): the lessons of the classes the caller is enrolled in — `active` or
// `completed` (`relation: self`) — and, while the caller holds the `guardian`
// role, those of their linked children's classes (`relation: child`). One item
// per lesson × student, so a guardian with two children in one class gets each
// lesson twice; `limit` counts lessons, so a page can hold more items. A user
// without an owned enrollment (a teacher, an admin) gets an empty list, never a
// 403. The item carries the student's own attendance status and lateness —
// never the teacher's note, who recorded it or the cancellation reason.
import type { AttendanceStatus } from './attendance'
import { apiRequest } from './client'
import type { MyClassRelation, MyClassStudent, MyClassTeacher } from './enrollments'
import type { DeliveryMode, Lesson, LessonSortOrder, LessonStatus, LessonSyllabusItem } from './lessons'
import type { LocalizedLabel } from './users'

/** `MyLessonAttendanceDto`: the student's own record — status and lateness only (D-R32). */
export interface MyLessonAttendance {
  status: AttendanceStatus
  /** With `late` only. */
  minutesLate: number | null
  /** ISO 8601 — when the record was first written. */
  recordedAt: string
}

/** `MyLessonItemDto`: one lesson the caller owns through one student. */
export interface MyLessonItem {
  /** The lesson (repeated when the caller owns it through several students — key rows by lesson AND student). */
  id: string
  title: LocalizedLabel
  description: LocalizedLabel | null
  deliveryMode: DeliveryMode
  /** ISO 8601 (UTC). */
  startsAt: string
  endsAt: string
  /** Cancelled lessons are listed with their status; the reason is never sent here. */
  status: LessonStatus
  /** The meeting link as stored (https only). */
  meetingUrl: string | null
  /** `ScheduleRoomDto` — the same shape as a lesson's room. */
  room: Lesson['room']
  /** The lesson's teacher by name only (no id, no contact fields); null = none. */
  teacher: MyClassTeacher | null
  syllabusItem: LessonSyllabusItem | null
  /** `TimetableClassDto` — the same shape as a lesson's class. */
  class: Lesson['class']
  relation: MyClassRelation
  /** The enrolled student the item is about (identity only). */
  student: MyClassStudent
  /** That student's attendance in the lesson; null until recorded. */
  attendance: MyLessonAttendance | null
}

export interface MyLessonList {
  /** By start time then lesson id; inside a lesson `self` → `child` by student id. */
  items: MyLessonItem[]
  /** Cursor of the next page of lessons; null on the last page. */
  nextCursor: string | null
}

export interface ListMyLessonsParams {
  /** Lessons of this class only (a class the caller does not own matches nothing). */
  classId?: string
  /** Lessons owned through this student only — the caller or one of their children (anyone else matches nothing). */
  studentId?: string
  status?: LessonStatus
  /** ISO 8601 instants with an offset or `Z`: lessons starting in `[from, to]`. */
  from?: string
  to?: string
  /** By start time, then id; `asc` by default. */
  order?: LessonSortOrder
  /** Lessons per page, 1–100 (server default 20). */
  limit?: number
  /** Opaque `nextCursor`; send it with the same filters and order. */
  cursor?: string
}

export const MY_LESSONS_PATH = '/api/me/lessons'

/** `/api/me/lessons?…` with the given parameters only, in a fixed order (URLSearchParams encodes the `+` of an offset). */
export function myLessonsPath(params: ListMyLessonsParams = {}): string {
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
  return search ? `${MY_LESSONS_PATH}?${search}` : MY_LESSONS_PATH
}

/** API-101 (no permission key — ownership): 400 on a malformed filter or `cursor_invalid`. */
export function listMyLessons(params: ListMyLessonsParams = {}, signal?: AbortSignal): Promise<MyLessonList> {
  return apiRequest<MyLessonList>(myLessonsPath(params), { signal })
}
