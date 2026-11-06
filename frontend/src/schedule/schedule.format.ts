// Pure helpers of the schedule screen (J-F05): weekday keys and order, day
// grouping, and the row shape both views (the academy schedule and «my
// schedule») render. Unit-tested in schedule.format.test.ts.
import type { Room } from '../api/rooms'
import type { MyScheduleItem, MyScheduleRelation, ScheduleRoom, TimetableSlot } from '../api/schedule'
import type { Language } from '../i18n/language'
import { displayNameOf, localizedLabel } from '../users/users.format'

/** The room picker filters the (small, unsearchable) rooms list on the client: code, names and branch code, case-insensitively. */
export function matchesRoom(room: Pick<Room, 'code' | 'name' | 'branch'>, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const haystack = [room.code, room.name?.ar, room.name?.en, room.name?.tr, room.branch?.code].filter((value): value is string => typeof value === 'string')
  return haystack.some((value) => value.toLowerCase().includes(needle))
}

/** 0 = Sunday … 6 = Saturday, as the server numbers weekdays (`days.*` translation keys). */
export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number]

/** Reading the academy schedule needs either key (D-R27); «my schedule» needs `schedule.read`. */
export const ACADEMY_SCHEDULE_PERMISSIONS = ['schedule.manage', 'classes.manage'] as const
export const MY_SCHEDULE_PERMISSION = 'schedule.read'

export function weekdayKey(weekday: number): WeekdayKey {
  return WEEKDAY_KEYS[((weekday % 7) + 7) % 7]!
}

/** The weekdays in display order, starting at `weekStartsOn` (0 = Sunday). */
export function weekdayOrder(weekStartsOn = 0): number[] {
  const start = ((weekStartsOn % 7) + 7) % 7
  return Array.from({ length: 7 }, (_, index) => (start + index) % 7)
}

/** One row of the schedule table — the same shape for both views. */
export interface ScheduleRow {
  key: string
  slotId: string
  weekday: number
  startTime: string
  endTime: string
  timeZone: string
  classId: string
  classCode: string
  className: string
  courseName: string
  room: ScheduleRoom | null
  /** The teacher's display name; null when the slot has no teacher (the lead teacher by default). */
  teacherName: string | null
  effectiveFrom: string
  effectiveTo: string | null
  /** «my schedule» only. */
  relation: MyScheduleRelation | null
  studentName: string | null
}

export function academyRow(slot: TimetableSlot, language: Language): ScheduleRow {
  return {
    key: slot.id,
    slotId: slot.id,
    weekday: slot.weekday,
    startTime: slot.startTime,
    endTime: slot.endTime,
    timeZone: slot.timeZone,
    classId: slot.class.id,
    classCode: slot.class.code,
    className: localizedLabel(slot.class.name, language),
    courseName: localizedLabel(slot.class.course.name, language),
    room: slot.room,
    teacherName: slot.teacher?.fullName ?? null,
    effectiveFrom: slot.effectiveFrom,
    effectiveTo: slot.effectiveTo,
    relation: null,
    studentName: null,
  }
}

export function myRow(item: MyScheduleItem, language: Language): ScheduleRow {
  return {
    key: `${item.id}:${item.relation}:${item.student?.id ?? ''}`,
    slotId: item.id,
    weekday: item.weekday,
    startTime: item.startTime,
    endTime: item.endTime,
    timeZone: item.timeZone,
    classId: item.class.id,
    classCode: item.class.code,
    className: localizedLabel(item.class.name, language),
    courseName: localizedLabel(item.class.course.name, language),
    room: item.room,
    teacherName: item.teacher ? displayNameOf(item.teacher) : null,
    effectiveFrom: item.effectiveFrom,
    effectiveTo: item.effectiveTo,
    relation: item.relation,
    studentName: item.student ? displayNameOf(item.student) : null,
  }
}

/**
 * Rows in display order: by weekday starting at `weekStartsOn`, then start
 * time, then the server's own order (stable). `firstOfDay` marks where a day
 * begins, so the table shows each day label once.
 */
export function orderRows<T extends Pick<ScheduleRow, 'weekday' | 'startTime'>>(rows: readonly T[], weekStartsOn = 0): Array<T & { firstOfDay: boolean }> {
  const rank = new Map(weekdayOrder(weekStartsOn).map((weekday, index) => [weekday, index]))
  const sorted = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank.get(a.row.weekday)! - rank.get(b.row.weekday)! || a.row.startTime.localeCompare(b.row.startTime) || a.index - b.index)
    .map(({ row }) => row)
  return sorted.map((row, index) => ({ ...row, firstOfDay: index === 0 || sorted[index - 1]!.weekday !== row.weekday }))
}

/** `HH:MM – HH:MM`, always left-to-right. */
export function timeRange(startTime: string, endTime: string): string {
  return `${startTime} – ${endTime}`
}

/** `LAB-1 — مختبر 1` (the name when it has one). */
export function roomLabel(room: Pick<ScheduleRoom, 'code' | 'name'>, language: Language): string {
  return room.name ? `${room.code} — ${localizedLabel(room.name, language)}` : room.code
}

/** Today as `YYYY-MM-DD` in the browser's zone (the `<input type="date">` value). */
export function todayIso(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A date input value the server accepts, or undefined (= today in the academy's zone). */
export function dateParam(value: string): string | undefined {
  return CALENDAR_DATE.test(value) ? value : undefined
}
