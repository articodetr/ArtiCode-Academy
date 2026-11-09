// Timetable readings (MOD-07-T04 — J-F05; moved here from api/schedule.ts by
// J-F08 to match backend/src/schedule/timetable.*): API-090 GET /api/schedule
// (the academy's weekly schedule, `schedule.manage` or `classes.manage`) and
// API-091 GET /api/me/schedule (`schedule.read` by ownership). Types mirror
// backend/src/schedule/timetable.dto.ts; every call goes through apiRequest
// (Bearer header, refresh-and-retry on 401). Times are local wall-clock
// `HH:MM` in the slot's `timeZone` (the room's branch, else the academy's).
import type { ClassStatus } from './classes'
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

export interface ScheduleBranch {
  id: string
  code: string
  name: LocalizedLabel
}

/** `ScheduleRoomDto`: the slot's room with its branch (null = the academy's own site). */
export interface ScheduleRoom {
  id: string
  code: string
  name: LocalizedLabel | null
  branch: ScheduleBranch | null
}

/** `ScheduleTeacherDto` (academy schedule): the teacher by id and name. */
export interface ScheduleTeacher {
  userId: string
  fullName: string
}

export interface ScheduleCourse {
  id: string
  code: string
  name: LocalizedLabel
}

/** `TimetableClassDto`: the class a slot belongs to, with its course. */
export interface ScheduleClass {
  id: string
  code: string
  name: LocalizedLabel
  status: ClassStatus
  course: ScheduleCourse
}

/** `TimetableSlotDto` (API-090): the API-088 slot plus its display time zone and its class. */
export interface TimetableSlot {
  id: string
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  /** `HH:MM` */
  startTime: string
  endTime: string
  room: ScheduleRoom | null
  teacher: ScheduleTeacher | null
  /** `YYYY-MM-DD` */
  effectiveFrom: string
  effectiveTo: string | null
  createdAt: string
  updatedAt: string
  /** IANA zone the times are read in. */
  timeZone: string
  class: ScheduleClass
}

export interface AcademySchedule {
  /** The calendar date the slots are effective on. */
  on: string
  /** By weekday, then start time, then id. */
  slots: TimetableSlot[]
}

export const MY_SCHEDULE_RELATIONS = ['self', 'child', 'teacher'] as const
export type MyScheduleRelation = (typeof MY_SCHEDULE_RELATIONS)[number]

export interface MyScheduleStudent {
  id: string
  fullName: string
  displayName: string | null
}

/** The teacher by name only (no id, no contact fields — the API-060 projection). */
export interface MyScheduleTeacher {
  fullName: string
  displayName: string | null
}

/** `MyScheduleItemDto` (API-091): one slot the caller owns through one relation. */
export interface MyScheduleItem {
  id: string
  weekday: number
  startTime: string
  endTime: string
  timeZone: string
  room: ScheduleRoom | null
  teacher: MyScheduleTeacher | null
  effectiveFrom: string
  effectiveTo: string | null
  class: ScheduleClass
  relation: MyScheduleRelation
  /** The enrolled student for `self` and `child`; null for `teacher`. */
  student: MyScheduleStudent | null
}

export interface MySchedule {
  on: string
  items: MyScheduleItem[]
}

export interface AcademyScheduleParams {
  /** `YYYY-MM-DD`; absent = today in the academy's time zone. */
  on?: string
  /** A branch id, or `none` for the rooms of the academy's own site. */
  branchId?: string
  roomId?: string
  teacherUserId?: string
  classId?: string
  /** 0–6 */
  weekday?: number
}

export interface MyScheduleParams {
  on?: string
}

export const SCHEDULE_PATH = '/api/schedule'
export const MY_SCHEDULE_PATH = '/api/me/schedule'

/** `/api/schedule?…` with the given filters only. */
export function academySchedulePath(params: AcademyScheduleParams = {}): string {
  const query = new URLSearchParams()
  if (params.on) query.set('on', params.on)
  if (params.branchId) query.set('branchId', params.branchId)
  if (params.roomId) query.set('roomId', params.roomId)
  if (params.teacherUserId) query.set('teacherUserId', params.teacherUserId)
  if (params.classId) query.set('classId', params.classId)
  if (params.weekday !== undefined) query.set('weekday', String(params.weekday))
  const search = query.toString()
  return search ? `${SCHEDULE_PATH}?${search}` : SCHEDULE_PATH
}

export function mySchedulePath(params: MyScheduleParams = {}): string {
  return params.on ? `${MY_SCHEDULE_PATH}?on=${encodeURIComponent(params.on)}` : MY_SCHEDULE_PATH
}

/** API-090: `schedule.manage` or `classes.manage`. */
export function getAcademySchedule(params: AcademyScheduleParams = {}, signal?: AbortSignal): Promise<AcademySchedule> {
  return apiRequest<AcademySchedule>(academySchedulePath(params), { signal })
}

/** API-091: `schedule.read`; the caller's own classes as student, guardian or teacher. */
export function getMySchedule(params: MyScheduleParams = {}, signal?: AbortSignal): Promise<MySchedule> {
  return apiRequest<MySchedule>(mySchedulePath(params), { signal })
}
