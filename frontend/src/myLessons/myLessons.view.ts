// Pure rules of «my lessons» (J-F11): the three views turned into API-101
// parameters, the row key (a lesson repeats once per owned student), the
// student and class filter options read from «my classes» (API-060 — the same
// ownership: `active`/`completed` enrollments, children while the caller holds
// `guardian`), and the attendance cell. No React, no i18next instance.
import type { AttendanceStatus } from '../api/attendance'
import type { MyClassItem, MyClassRelation, MyClassStudent } from '../api/enrollments'
import type { LessonSortOrder, LessonStatus } from '../api/lessons'
import type { ListMyLessonsParams, MyLessonItem } from '../api/myLessons'
import type { LocalizedLabel } from '../api/users'
import { dayEndInstant, dayStartInstant, todayIso } from '../lessons/lessons.format'

export const MY_LESSON_VIEWS = ['upcoming', 'past', 'range'] as const
export type MyLessonView = (typeof MY_LESSON_VIEWS)[number]

/** Lessons per page (`limit` counts lessons — a page can hold more rows). */
export const MY_LESSON_PAGE_SIZES = [20, 50, 100] as const

/** The roles that own lessons here: the server reads the `student` enrollments and the `guardian` links. */
const LEARNER_ROLE_KEYS: readonly string[] = ['student', 'guardian']

export interface MyLessonsFilters {
  view: MyLessonView
  /** The caller or one of their children; blank = every owned student. */
  studentId: string | undefined
  classId: string | undefined
  status: LessonStatus | undefined
  /** `range` view only: local calendar days (`YYYY-MM-DD`); blank = open-ended. */
  from: string | undefined
  to: string | undefined
  /** `range` view only — `upcoming` is always oldest first and `past` newest first. */
  order: LessonSortOrder
  limit: (typeof MY_LESSON_PAGE_SIZES)[number]
}

export function defaultMyLessonsFilters(): MyLessonsFilters {
  return { view: 'upcoming', studentId: undefined, classId: undefined, status: undefined, from: undefined, to: undefined, order: 'asc', limit: 20 }
}

/** The first instant of the browser's current day (ISO 8601, `Z`). */
export function todayStartInstant(now: Date = new Date()): string {
  return dayStartInstant(todayIso(now)) ?? now.toISOString()
}

/**
 * API-101 parameters of the filters at `now`. `upcoming` = lessons starting
 * today or later, oldest first (today's lessons stay there all day, so a
 * running lesson and its meeting link remain at the top); `past` = lessons
 * that started before today, newest first; `range` = the chosen days (both
 * inclusive) in the chosen order. The cursor is added by the caller.
 */
export function myLessonsQuery(filters: MyLessonsFilters, now: Date = new Date()): ListMyLessonsParams {
  const base: ListMyLessonsParams = { classId: filters.classId, studentId: filters.studentId, status: filters.status, limit: filters.limit }
  if (filters.view === 'upcoming') return { ...base, from: todayStartInstant(now), order: 'asc' }
  if (filters.view === 'past') return { ...base, to: new Date(new Date(todayStartInstant(now)).getTime() - 1).toISOString(), order: 'desc' }
  return { ...base, from: dayStartInstant(filters.from), to: dayEndInstant(filters.to), order: filters.order }
}

/** True when a filter beyond the view narrows the list (the empty text then says so). */
export function isNarrowed(filters: MyLessonsFilters): boolean {
  return Boolean(filters.studentId || filters.classId || filters.status || (filters.view === 'range' && (filters.from || filters.to)))
}

/** A row is a lesson × a student: the lesson id alone repeats for a guardian with two children in the class. */
export function myLessonKey(item: Pick<MyLessonItem, 'id' | 'student'>): string {
  return `${item.id}:${item.student.id}`
}

/** True for a holder of the `student` or `guardian` role key — the only callers API-101 can return lessons to. */
export function isLearner(roleKeys: readonly string[]): boolean {
  return roleKeys.some((key) => LEARNER_ROLE_KEYS.includes(key))
}

/** The student column matters to a guardian, or whenever the server returned a child's lesson. */
export function showsStudents(roleKeys: readonly string[], items: readonly Pick<MyLessonItem, 'relation'>[]): boolean {
  return roleKeys.includes('guardian') || items.some((item) => item.relation === 'child')
}

export interface MyStudentOption extends MyClassStudent {
  relation: MyClassRelation
}

function personName(person: { fullName: string; displayName: string | null }): string {
  return person.displayName?.trim() || person.fullName
}

/** The distinct students the caller owns lessons through: themselves first, then their children by name. */
export function studentOptionsOf(items: readonly Pick<MyClassItem, 'relation' | 'student'>[]): MyStudentOption[] {
  const byId = new Map<string, MyStudentOption>()
  for (const item of items) if (!byId.has(item.student.id)) byId.set(item.student.id, { ...item.student, relation: item.relation })
  return [...byId.values()].sort((a, b) => (a.relation === b.relation ? personName(a).localeCompare(personName(b)) : a.relation === 'self' ? -1 : 1))
}

export interface MyClassOption {
  id: string
  code: string
  name: LocalizedLabel
}

/** The distinct classes of the owned enrollments (of one student when given), by code. */
export function classOptionsOf(items: readonly { student: Pick<MyClassStudent, 'id'>; class: MyClassOption }[], studentId?: string): MyClassOption[] {
  const byId = new Map<string, MyClassOption>()
  for (const item of items) {
    if (studentId && item.student.id !== studentId) continue
    if (!byId.has(item.class.id)) byId.set(item.class.id, { id: item.class.id, code: item.class.code, name: item.class.name })
  }
  return [...byId.values()].sort((a, b) => a.code.localeCompare(b.code))
}

export type MyAttendanceCell =
  | { kind: 'recorded'; status: AttendanceStatus; minutesLate: number | null }
  /** A cancelled lesson without a record: there is nothing to record. */
  | { kind: 'cancelled' }
  /** The lesson has not started yet (attendance opens at its start — D-R33). */
  | { kind: 'not_started' }
  | { kind: 'not_recorded' }

/** What the attendance column shows: the student's own record first, else why there is none. */
export function attendanceCellOf(item: Pick<MyLessonItem, 'attendance' | 'status' | 'startsAt'>, now: Date = new Date()): MyAttendanceCell {
  if (item.attendance) return { kind: 'recorded', status: item.attendance.status, minutesLate: item.attendance.status === 'late' ? item.attendance.minutesLate : null }
  if (item.status === 'cancelled') return { kind: 'cancelled' }
  const start = new Date(item.startsAt).getTime()
  if (!Number.isNaN(start) && start > now.getTime()) return { kind: 'not_started' }
  return { kind: 'not_recorded' }
}

/** Tag colors of the four statuses — the same as the attendance summary of the lesson drawer (J-F09). */
export const ATTENDANCE_COLORS: Readonly<Record<AttendanceStatus, string>> = {
  present: 'green',
  absent: 'red',
  late: 'gold',
  excused: 'blue',
}
