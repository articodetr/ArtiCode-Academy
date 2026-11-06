// Weekly class schedule (MOD-07-T03 — O9): API-088 GET /api/classes/:id/schedule
// (`classes.read` with the class's visibility — D-R16: a class the caller may
// not see is 404) and API-089 PUT /api/classes/:id/schedule (`schedule.manage`:
// the whole list, applied by the server as a diff — an identical list writes
// nothing). Types mirror backend/src/schedule/class-schedule.dto.ts; every call
// goes through apiRequest (Bearer header, refresh-and-retry on 401).
import { apiRequest } from './client'
import type { RoomBranch } from './rooms'
import type { LocalizedLabel } from './users'

/** Upper bound of one class's weekly slots (`SCHEDULE_SLOTS_MAX` of the DTO — also the body limit). */
export const SCHEDULE_SLOTS_MAX = 50

/** 0 = Sunday … 6 = Saturday, as `settings.scheduling.*` counts them. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** `ScheduleRoomDto`: the slot's room by id, code and name, with its branch (null = the academy's own site). */
export interface ScheduleRoom {
  id: string
  code: string
  name: LocalizedLabel | null
  branch: RoomBranch | null
}

/** `ScheduleTeacherDto`: by id and name only (no contact fields). */
export interface ScheduleTeacher {
  userId: string
  fullName: string
}

/** `ScheduleSlotDto` (API-088/API-089). */
export interface ScheduleSlot {
  id: string
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  /** `HH:MM`, local wall-clock time of the room's branch, else the academy's. */
  startTime: string
  /** `HH:MM`, later than `startTime`; slots are half-open, so 10:00–11:00 and 11:00–12:00 do not overlap. */
  endTime: string
  room: ScheduleRoom | null
  /** null = the lead teacher at generation time (D-R26). */
  teacher: ScheduleTeacher | null
  /** `YYYY-MM-DD`, inclusive. */
  effectiveFrom: string
  /** `YYYY-MM-DD`, inclusive; null = open-ended. */
  effectiveTo: string | null
  createdAt: string
  updatedAt: string
}

/** `ClassScheduleDto`: the slots by weekday, then start time, then id. */
export interface ClassSchedule {
  classId: string
  slots: ScheduleSlot[]
}

/**
 * One slot of the body of API-089 (`ScheduleSlotInputDto`): an `id` keeps an
 * existing slot (updated when a value differs), no `id` creates one; `roomId`,
 * `teacherUserId` and `effectiveTo` are sent as explicit `null` when empty.
 */
export interface ScheduleSlotInput {
  id?: string
  weekday: number
  startTime: string
  endTime: string
  roomId: string | null
  teacherUserId: string | null
  effectiveFrom: string
  effectiveTo: string | null
}

/** Body of API-089: the whole final list (`[]` removes every slot); up to `SCHEDULE_SLOTS_MAX`. */
export interface ReplaceClassScheduleInput {
  slots: ScheduleSlotInput[]
}

export function classSchedulePath(classId: string): string {
  return `/api/classes/${encodeURIComponent(classId)}/schedule`
}

/** API-088: 404 `class_not_found` for a class the caller may not see. */
export function getClassSchedule(classId: string, signal?: AbortSignal): Promise<ClassSchedule> {
  return apiRequest<ClassSchedule>(classSchedulePath(classId), { signal })
}

/** API-089 (`schedule.manage`): answers with the schedule after the replacement. */
export function replaceClassSchedule(classId: string, input: ReplaceClassScheduleInput): Promise<ClassSchedule> {
  return apiRequest<ClassSchedule>(classSchedulePath(classId), { method: 'PUT', body: input })
}
