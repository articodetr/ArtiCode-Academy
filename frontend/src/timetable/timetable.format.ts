// Pure labels of the schedule screen (J-F05, moved from schedule/schedule.format.ts
// and extended by J-F08): weekday keys and order, permission keys, room and
// time labels, and the localized calendar dates of the weekly calendar.
// Dates are formatted with Intl on UTC midnights (no zone can shift them) and
// Latin digits in Arabic, as users.format.ts does. Unit-tested in
// timetable.format.test.ts.
import type { Room } from '../api/rooms'
import type { ScheduleRoom } from '../api/timetable'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'
import type { CalendarDate, CalendarMonth } from './timetable.dates'
import { firstOfMonth } from './timetable.dates'

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

/** `HH:MM – HH:MM` — render it inside a `dir="ltr"` span so Arabic never reverses it. */
export function timeRange(startTime: string, endTime: string): string {
  return `${startTime} – ${endTime}`
}

/** `LAB-1 — مختبر 1` (the name when it has one). */
export function roomLabel(room: Pick<ScheduleRoom, 'code' | 'name'>, language: Language): string {
  return room.name ? `${room.code} — ${localizedLabel(room.name, language)}` : room.code
}

/** A person by display name, else full name. */
export function personName(person: { fullName: string; displayName: string | null }): string {
  return person.displayName?.trim() || person.fullName
}

type Translate = (key: string, options?: Record<string, unknown>) => string

/** «أنا» / «ابني/ابنتي: أحمد» / «أُدرّسه» — why «my schedule» shows a slot. */
export function relationLabel(t: Translate, relation: { relation: string; student: { fullName: string; displayName: string | null } | null }): string {
  if (relation.relation === 'child' && relation.student) return t('schedule.details.child', { name: personName(relation.student) })
  return t(`schedule.relation.${relation.relation}`)
}

/** Everything a card says, for its accessible name (the card's own text is abridged by its height). */
export function slotLabel(
  t: Translate,
  language: Language,
  slot: {
    courseName: string
    classCode: string
    date: CalendarDate
    startTime: string
    endTime: string
    room: string | null
    /** null = the slot names no teacher (the class's lead teacher teaches it). */
    teacher: string | null
    relations: string[]
  },
): string {
  const parts = [
    t('schedule.calendar.slotLabel', { course: slot.courseName, class: slot.classCode, day: formatLongDate(slot.date, language), start: slot.startTime, end: slot.endTime }),
    slot.room ? t('schedule.calendar.slotRoom', { room: slot.room }) : t('schedule.noRoom'),
    slot.teacher ? t('schedule.calendar.slotTeacher', { name: slot.teacher }) : t('schedule.noTeacher'),
    ...slot.relations,
  ]
  return parts.join(language === 'ar' ? '، ' : ', ')
}

/** Arabic with Latin digits keeps dates aligned with codes and times elsewhere on the page. */
export function intlLocale(language: Language): string {
  return language === 'ar' ? 'ar-u-nu-latn' : 'en-GB'
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(language: Language, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${language}|${JSON.stringify(options)}`
  let value = formatters.get(key)
  if (!value) {
    value = new Intl.DateTimeFormat(intlLocale(language), { ...options, timeZone: 'UTC' })
    formatters.set(key, value)
  }
  return value
}

function utcDate(date: CalendarDate): Date {
  return new Date(`${date}T00:00:00Z`)
}

/** The day of the month, two digits (`07`) — the number on the week header. */
export function dayNumber(date: CalendarDate): string {
  return date.slice(8, 10)
}

/** `السبت، 7 نوفمبر 2026` / `Saturday 7 November 2026`. */
export function formatLongDate(date: CalendarDate, language: Language): string {
  return formatter(language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(utcDate(date))
}

/** `7 نوفمبر` / `7 November`. */
export function formatDayMonth(date: CalendarDate, language: Language): string {
  return formatter(language, { day: 'numeric', month: 'long' }).format(utcDate(date))
}

/** `7 نوفمبر 2026` / `7 November 2026`. */
export function formatDate(date: CalendarDate, language: Language): string {
  return formatter(language, { day: 'numeric', month: 'long', year: 'numeric' }).format(utcDate(date))
}

/** `نوفمبر 2026` / `November 2026`. */
export function formatMonthTitle(month: CalendarMonth, language: Language): string {
  return formatter(language, { month: 'long', year: 'numeric' }).format(utcDate(firstOfMonth(month)))
}

/** `1–7 نوفمبر 2026`, `29 نوفمبر – 5 ديسمبر 2026` — the range of the visible week. */
export function formatDateRange(first: CalendarDate, last: CalendarDate, language: Language): string {
  if (first === last) return formatDate(first, language)
  const value = formatter(language, { day: 'numeric', month: 'long', year: 'numeric' })
  return typeof value.formatRange === 'function' ? value.formatRange(utcDate(first), utcDate(last)) : `${value.format(utcDate(first))} – ${value.format(utcDate(last))}`
}
