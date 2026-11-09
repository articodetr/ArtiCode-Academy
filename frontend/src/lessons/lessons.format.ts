// Pure helpers of the lessons screens (J-F09): instants ↔ the native date and
// time inputs, the range rule of lessons.time.ts, and the labels the list and
// the drawer render. Everything here reads the browser's local time, the
// display included: D-R33 (5) names the academy's (or the room's branch's)
// zone as the display zone, and moving the list and the drawer there is an
// open product decision for the owner (J-F19 — master doc 08, MOD-06). No
// React, no i18next instance.
import { MAX_LESSON_HOURS } from '../api/lessons'
import type { Lesson } from '../api/lessons'
import type { ScheduleRoom } from '../api/timetable'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/
const CLOCK_TIME = /^\d{2}:\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

/** The mark of an end on the next day, after the end time (list, drawer and the form's end time — J-F19). */
export const NEXT_DAY_MARK = '(+1)'

const pad = (value: number) => String(value).padStart(2, '0')

/** The instant as the browser's local `YYYY-MM-DD` and `HH:MM` (the values of the native inputs). */
export function localPartsOf(iso: string): { date: string; time: string } {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return { date: '', time: '' }
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  }
}

/** Today as the browser's local `YYYY-MM-DD` — the default «from» of the lessons list. */
export function todayIso(now: Date = new Date()): string {
  return localPartsOf(now.toISOString()).date
}

/** A local date and time → ISO 8601 instant (UTC, `Z`), or undefined when either is missing or malformed. */
export function toInstant(date: string | undefined, time: string | undefined): string | undefined {
  if (!date || !time || !CALENDAR_DATE.test(date) || !CLOCK_TIME.test(time)) return undefined
  const value = new Date(`${date}T${time}:00`)
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
}

/** The calendar day after a `YYYY-MM-DD` date (plain calendar arithmetic, no time zone involved). */
function nextCalendarDate(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

/**
 * The lesson's range from the form's day and two clock times: an end time at
 * or before the start time means the lesson ends on the next day (a 22:00 →
 * 01:00 session) — `nextDay` says that it rolled over, so the form can mark it
 * beside the end time (J-F19). The end is the typed time on the next calendar
 * day, not 24 hours after the same-day time: on a night the clock changes
 * (DST) those differ by an hour. Undefined when a part is missing.
 */
export function rangeOf(date: string | undefined, startTime: string | undefined, endTime: string | undefined): { startsAt: string; endsAt: string; nextDay: boolean } | undefined {
  const startsAt = toInstant(date, startTime)
  const sameDayEnd = toInstant(date, endTime)
  if (!date || !startsAt || !sameDayEnd) return undefined
  const nextDay = new Date(sameDayEnd).getTime() <= new Date(startsAt).getTime()
  const endsAt = nextDay ? toInstant(nextCalendarDate(date), endTime) : sameDayEnd
  return endsAt ? { startsAt, endsAt, nextDay } : undefined
}

/**
 * The range the form marks as ending on the next day (J-F19), or undefined: a
 * missing part, an end after the start, or an end equal to the start — which
 * the form refuses as an empty range rather than a 24-hour lesson.
 */
export function nextDayRangeOf(date: string | undefined, startTime: string | undefined, endTime: string | undefined): { startsAt: string; endsAt: string } | undefined {
  if (startTime === endTime) return undefined
  const range = rangeOf(date, startTime, endTime)
  return range?.nextDay ? { startsAt: range.startsAt, endsAt: range.endsAt } : undefined
}

/** Why a range is refused (mirror of `timeRangeProblem()`): `empty` when the end is not after the start, `too_long` beyond 12 hours. */
export function rangeProblem(startsAt: string, endsAt: string, maxHours: number = MAX_LESSON_HOURS): 'empty' | 'too_long' | null {
  const span = new Date(endsAt).getTime() - new Date(startsAt).getTime()
  if (Number.isNaN(span) || span <= 0) return 'empty'
  if (span > maxHours * 60 * 60 * 1000) return 'too_long'
  return null
}

/** Whole minutes between the two instants (0 when malformed). */
export function durationMinutes(startsAt: string, endsAt: string): number {
  const span = new Date(endsAt).getTime() - new Date(startsAt).getTime()
  return Number.isNaN(span) || span < 0 ? 0 : Math.round(span / 60_000)
}

/** The first instant of a local calendar day as ISO 8601 (the `from` filter), or undefined for a blank or malformed input. */
export function dayStartInstant(date: string | undefined): string | undefined {
  return toInstant(date, '00:00')
}

/** The last millisecond of a local calendar day as ISO 8601 (the `to` filter — the server compares inclusively). */
export function dayEndInstant(date: string | undefined): string | undefined {
  const start = toInstant(date, '00:00')
  return start ? new Date(new Date(start).getTime() + DAY_MS - 1).toISOString() : undefined
}

function intlLocale(language: Language): string {
  // Arabic with Latin digits, as users.format.ts: times line up with the identifiers around them.
  return language === 'ar' ? 'ar-u-nu-latn' : 'en-GB'
}

/** `HH:MM` (24 h, Latin digits) of an instant in the browser's zone. */
export function formatClock(iso: string, language: Language): string {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return iso
  return new Intl.DateTimeFormat(intlLocale(language), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value)
}

/** `10:00 – 11:30` (always left-to-right); a lesson ending on another day shows that day after the end time. */
export function formatLessonTimes(startsAt: string, endsAt: string, language: Language): string {
  const start = localPartsOf(startsAt)
  const end = localPartsOf(endsAt)
  const range = `${formatClock(startsAt, language)} – ${formatClock(endsAt, language)}`
  return start.date === end.date || !end.date ? range : `${range} ${NEXT_DAY_MARK}`
}

/** The lesson's day, localized (medium date style). */
export function formatLessonDay(iso: string, language: Language): string {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return iso
  return new Intl.DateTimeFormat(intlLocale(language), { dateStyle: 'medium' }).format(value)
}

/** `LAB-1 — مختبر 1` (the name when it has one), as the schedule screen. */
export function lessonRoomLabel(room: Pick<ScheduleRoom, 'code' | 'name'>, language: Language): string {
  return room.name ? `${room.code} — ${localizedLabel(room.name, language)}` : room.code
}

/** `3. الحلقات` — the item's position (1-based) and title. */
export function syllabusItemLabel(item: { sortOrder: number; title: { ar: string; en?: string; tr?: string } }, language: Language): string {
  return `${item.sortOrder + 1}. ${localizedLabel(item.title, language)}`
}

/** The lesson's title in the active language (the mandatory Arabic as the fallback). */
export function lessonTitle(lesson: Pick<Lesson, 'title'>, language: Language): string {
  return localizedLabel(lesson.title, language)
}
