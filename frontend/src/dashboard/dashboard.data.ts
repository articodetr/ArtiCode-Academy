// Pure rules of the dashboard (redesign, 2026-11-14): where a lesson sits on the day timeline, which state it shows,
// how lessons are packed into rows, grouped by teacher or room, and what the «needs you» list holds.
// No request and no React here — dashboard.data.test.ts covers them.
import type { Lesson } from '../api/lessons'
import type { AcademyClass } from '../api/classes'
import type { ReportsOverview } from '../api/reports'
import type { LocalizedLabel } from '../api/users'
import { wallClockIn } from '../common/timeZone'
import { clockMinutes } from '../timetable/timetable.dates'

/** The calendar day of an instant in `zone`, `YYYY-MM-DD`. */
export function wallDate(iso: string, zone: string): string {
  return wallClockIn(iso, zone).date
}

/** Minutes since midnight of an instant on the wall clock of `zone`. */
export function minutesIn(iso: string, zone: string): number {
  return clockMinutes(wallClockIn(iso, zone).time)
}

export interface DayWindow {
  /** First and last shown minute of the day; whole hours. */
  start: number
  end: number
}

/**
 * The hours the timeline shows: 09:00–20:00 at least, widened to whole hours so every lesson of the day fits
 * (a lesson that ends after midnight is cut at 24:00).
 */
export function dayWindow(lessons: readonly Lesson[], zone: string): DayWindow {
  let start = 9 * 60
  let end = 20 * 60
  for (const lesson of lessons) {
    const from = minutesIn(lesson.startsAt, zone)
    const to = minutesIn(lesson.endsAt, zone)
    start = Math.min(start, Math.floor(from / 60) * 60)
    end = Math.max(end, to <= from ? 24 * 60 : Math.ceil(to / 60) * 60)
  }
  return { start, end: Math.min(end, 24 * 60) }
}

export function hoursOf(window: DayWindow): number[] {
  const hours: number[] = []
  for (let minute = window.start; minute < window.end; minute += 60) hours.push(minute / 60)
  return hours
}

export interface Placed {
  /** Share of the window before the block and the block's own share, 0..1. */
  offset: number
  size: number
}

export function place(lesson: Pick<Lesson, 'startsAt' | 'endsAt'>, window: DayWindow, zone: string): Placed {
  const span = window.end - window.start
  const from = Math.max(minutesIn(lesson.startsAt, zone), window.start)
  let to = minutesIn(lesson.endsAt, zone)
  if (to <= from) to = window.end
  to = Math.min(to, window.end)
  return { offset: (from - window.start) / span, size: Math.max(to - from, 15) / span }
}

/** Where "now" falls in the window (0..1), or null when now is outside it. */
export function nowOffset(window: DayWindow, nowMinutes: number): number | null {
  if (nowMinutes < window.start || nowMinutes > window.end) return null
  return (nowMinutes - window.start) / (window.end - window.start)
}

export type LessonState = 'cancelled' | 'needsAttendance' | 'done' | 'running' | 'upcoming'

/**
 * What a lesson block shows: a started lesson without an attendance sheet needs the user (chalk yellow) — the
 * server accepts attendance once a lesson has started (`attendanceBlocker()`), whatever its status but cancelled.
 */
export function lessonState(lesson: Pick<Lesson, 'status' | 'startsAt' | 'endsAt' | 'attendanceTakenAt'>, now: number): LessonState {
  if (lesson.status === 'cancelled') return 'cancelled'
  const started = Date.parse(lesson.startsAt) <= now
  if (started && lesson.attendanceTakenAt === null) return 'needsAttendance'
  if (lesson.status === 'completed' || Date.parse(lesson.endsAt) <= now) return 'done'
  return started ? 'running' : 'upcoming'
}

/** Packs lessons into as few rows as possible, none overlapping inside a row, each row in start order. */
export function packRows<T extends Pick<Lesson, 'startsAt' | 'endsAt'>>(lessons: readonly T[]): T[][] {
  const sorted = [...lessons].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  const rows: T[][] = []
  for (const lesson of sorted) {
    const row = rows.find((candidate) => Date.parse(candidate[candidate.length - 1].endsAt) <= Date.parse(lesson.startsAt))
    if (row) row.push(lesson)
    else rows.push([lesson])
  }
  return rows
}

export interface Lane<T> {
  key: string
  /** The teacher's or the room's lessons, in start order. */
  lessons: T[]
}

/** One lane per teacher who teaches today, by name; lessons without a teacher in a last lane keyed `none`. */
export function lanesByTeacher(lessons: readonly Lesson[]): Lane<Lesson>[] {
  return lanes(lessons, (lesson) => (lesson.teacher ? { key: lesson.teacher.userId, label: lesson.teacher.fullName } : null))
}

/** One lane per room used today, by code; online lessons (no room) in a last lane keyed `none`. */
export function lanesByRoom(lessons: readonly Lesson[]): Lane<Lesson>[] {
  return lanes(lessons, (lesson) => (lesson.room ? { key: lesson.room.id, label: lesson.room.code } : null))
}

function lanes(lessons: readonly Lesson[], keyOf: (lesson: Lesson) => { key: string; label: string } | null): Lane<Lesson>[] {
  const byKey = new Map<string, { label: string; lessons: Lesson[] }>()
  const none: Lesson[] = []
  for (const lesson of lessons) {
    const key = keyOf(lesson)
    if (!key) {
      none.push(lesson)
      continue
    }
    const lane = byKey.get(key.key) ?? { label: key.label, lessons: [] }
    lane.lessons.push(lesson)
    byKey.set(key.key, lane)
  }
  const byStart = (a: Lesson, b: Lesson) => Date.parse(a.startsAt) - Date.parse(b.startsAt)
  const result = [...byKey.entries()]
    .sort(([, a], [, b]) => a.label.localeCompare(b.label))
    .map(([key, lane]) => ({ key, lessons: lane.lessons.sort(byStart) }))
  if (none.length) result.push({ key: 'none', lessons: none.sort(byStart) })
  return result
}

/** Minutes of teaching per lane (a cancelled lesson does not count). */
export function busyMinutes(lessons: readonly Lesson[]): number {
  return lessons
    .filter((lesson) => lesson.status !== 'cancelled')
    .reduce((sum, lesson) => sum + Math.max(0, (Date.parse(lesson.endsAt) - Date.parse(lesson.startsAt)) / 60000), 0)
}

export type AttentionKind = 'attendance' | 'review' | 'overdue' | 'noTeacher'

export interface AttentionItem {
  kind: AttentionKind
  count: number
  /** Where the action leads. */
  path: string
  /** Extra values for the item's wording (a lesson's name, an amount…). */
  detail?: Record<string, string | number>
}

/** Classes that still run or will run, and have no teacher at all. */
export function classesWithoutTeacher(classes: readonly AcademyClass[]): AcademyClass[] {
  return classes.filter((klass) => ['planned', 'open', 'running'].includes(klass.status) && klass.teachers.length === 0)
}

/**
 * The «needs you» list, from what the caller could read (a source the caller may not read is null and adds
 * nothing): today's started lessons without attendance, attempts waiting for review, overdue money, classes
 * without a teacher. Items with a zero count are left out.
 */
export function attentionItems(input: {
  todayLessons: readonly Lesson[] | null
  overview: ReportsOverview | null
  classes: readonly AcademyClass[] | null
  now: number
}): AttentionItem[] {
  const items: AttentionItem[] = []
  if (input.todayLessons) {
    const missing = input.todayLessons.filter((lesson) => lessonState(lesson, input.now) === 'needsAttendance')
    if (missing.length) items.push({ kind: 'attendance', count: missing.length, path: '/lessons' })
  }
  const review = input.overview?.academic?.awaitingReview ?? 0
  if (review) items.push({ kind: 'review', count: review, path: '/assignments' })
  for (const row of input.overview?.financial?.outstanding ?? []) {
    if (row.overdue > 0) items.push({ kind: 'overdue', count: row.studentsOverdue, path: '/payments', detail: { amount: row.overdue, currency: row.currency } })
  }
  if (input.classes) {
    const bare = classesWithoutTeacher(input.classes)
    if (bare.length) items.push({ kind: 'noTeacher', count: bare.length, path: '/classes' })
  }
  return items
}

/** The `count` months ending with `month` (`YYYY-MM`), oldest first. */
export function monthsBack(month: string, count: number): string[] {
  const [year, mon] = month.split('-').map(Number)
  const months: string[] = []
  for (let i = count - 1; i >= 0; i -= 1) {
    const index = year * 12 + (mon - 1) - i
    months.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`)
  }
  return months
}

/** Money as the academy writes it, with the currency symbol and no more than two decimals. */
export function formatMoney(amount: number, currency: string, language: string): string {
  try {
    return new Intl.NumberFormat(language === 'ar' ? 'ar-u-nu-latn' : language, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

/** A server label in the UI language, the Arabic text when that language is missing. */
export function labelIn(text: LocalizedLabel, language: string): string {
  return (language === 'en' ? text.en : language === 'tr' ? text.tr : undefined) || text.ar
}

export const DASHBOARD_VIEWS = ['today', 'week', 'classes', 'teachers', 'rooms', 'finance'] as const
export type DashboardView = (typeof DASHBOARD_VIEWS)[number]

/** Which views a caller sees: each one needs the keys of the reads behind it (the server stays the boundary). */
export function visibleViews(has: (key: string) => boolean): DashboardView[] {
  const manages = has('classes.manage') || has('schedule.manage')
  return DASHBOARD_VIEWS.filter((view) => {
    switch (view) {
      case 'today':
        return true
      case 'week':
        return has('lessons.read')
      case 'classes':
        return has('classes.read')
      case 'teachers':
      case 'rooms':
        return has('lessons.read') && manages
      case 'finance':
        return has('reports.financial.view')
    }
  })
}
