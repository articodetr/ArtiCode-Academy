// Pure helpers of the lessons screens (J-F09): instants ↔ the native date and
// time inputs, the range rule of lessons.time.ts, and the labels the list and
// the drawer render. Every wall-clock value here belongs to a named IANA zone
// (D-R41 — J-F28): a lesson's own `timeZone` (its room's branch, else the
// academy's — the server decides) for its times, shown and typed; the
// academy's for «today», the day filters and a lesson not created yet. The
// browser's zone is read in one place only, deviceTimeZone(), which the
// screens name beside a lesson zone that differs from it. Conversions go
// through the timetable's zonedInstant() (DST-safe, a mirror of the server's).
// No React, no i18next instance.
import { MAX_LESSON_HOURS } from '../api/lessons'
import type { Lesson } from '../api/lessons'
import type { ScheduleRoom } from '../api/timetable'
import type { Language } from '../i18n/language'
import { addDays, calendarDateIn, clockOfMinutes, isCalendarDate, isTimeZone, minutesNowIn, zonedInstant } from '../timetable/timetable.dates'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { localizedLabel } from '../users/users.format'

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const EMPTY = '—'

/** The mark of an end on the next day, after the end time (list, drawer and the form's end time — J-F19). */
export const NEXT_DAY_MARK = '(+1)'

/** Where the zone of the shown or typed times comes from — the screens say it beside the zone's name. */
export type LessonZoneSource = 'lesson' | 'academy' | 'device'

export interface LessonZone {
  /** IANA name. */
  timeZone: string
  /** `lesson` = the lesson's own (D-R41); `academy` = API-035 `timezone`; `device` = this device's, when the academy could not be read. */
  source: LessonZoneSource
}

/**
 * The academy's zone (API-035 `timezone`) — the zone of «today», of the day
 * filters and of the times typed for a new lesson — or this device's when the
 * academy could not be read (as the timetable falls back).
 */
export function academyZoneOf(academy: { timezone?: unknown } | null): LessonZone {
  const zone = academy?.timezone
  return isTimeZone(zone) ? { timeZone: zone, source: 'academy' } : { timeZone: deviceTimeZone(), source: 'device' }
}

const canonicalZones = new Map<string, string>()

/** The name Intl resolves a zone to, so an alias (Etc/UTC, Asia/Kolkata) compares equal to its canonical name. */
function canonicalZone(timeZone: string): string {
  let canonical = canonicalZones.get(timeZone)
  if (canonical === undefined) {
    try {
      canonical = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone
    } catch {
      canonical = timeZone
    }
    canonicalZones.set(timeZone, canonical)
  }
  return canonical
}

/** True when the two names denote one zone. */
export function sameTimeZone(a: string, b: string): boolean {
  return a === b || canonicalZone(a) === canonicalZone(b)
}

/** True when `timeZone` is not this device's zone: the screens then name both zones (D-R41). */
export function differsFromDevice(timeZone: string, device: string = deviceTimeZone()): boolean {
  return !sameTimeZone(timeZone, device)
}

/** The instant as `YYYY-MM-DD` and `HH:MM` on the wall clock of `timeZone` (the values of the native inputs). */
export function zonedPartsOf(iso: string, timeZone: string): { date: string; time: string } {
  const instant = new Date(iso).getTime()
  if (Number.isNaN(instant)) return { date: '', time: '' }
  return { date: calendarDateIn(timeZone, instant), time: clockOfMinutes(minutesNowIn(timeZone, instant)) }
}

/** Today in `timeZone` as `YYYY-MM-DD` — the default «from» of the lessons list (the academy's day — D-R41). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return calendarDateIn(timeZone, now.getTime())
}

/**
 * A wall-clock date and time in `timeZone` → ISO 8601 instant (UTC, `Z`), or
 * undefined when either is missing or malformed. A time a DST gap skips moves
 * forward; one that occurs twice resolves as zonedInstant() says.
 */
export function toInstant(date: string | undefined, time: string | undefined, timeZone: string): string | undefined {
  if (!date || !time || !isCalendarDate(date) || !CLOCK_TIME.test(time)) return undefined
  return new Date(zonedInstant(date, time, timeZone)).toISOString()
}

/**
 * The lesson's range from the form's day and two clock times in `timeZone`: an
 * end time at or before the start time means the lesson ends on the next day
 * (a 22:00 → 01:00 session) — `nextDay` says that it rolled over, so the form
 * can mark it beside the end time (J-F19). The end is the typed time on the
 * next calendar day of that zone, not 24 hours after the same-day time: on a
 * night the zone's clock changes (DST) those differ by an hour. Undefined
 * when a part is missing.
 */
export function rangeOf(
  date: string | undefined,
  startTime: string | undefined,
  endTime: string | undefined,
  timeZone: string,
): { startsAt: string; endsAt: string; nextDay: boolean } | undefined {
  const startsAt = toInstant(date, startTime, timeZone)
  const sameDayEnd = toInstant(date, endTime, timeZone)
  if (!date || !startsAt || !sameDayEnd) return undefined
  const nextDay = new Date(sameDayEnd).getTime() <= new Date(startsAt).getTime()
  const endsAt = nextDay ? toInstant(addDays(date, 1), endTime, timeZone) : sameDayEnd
  return endsAt ? { startsAt, endsAt, nextDay } : undefined
}

/**
 * The range the form marks as ending on the next day (J-F19), or undefined: a
 * missing part, an end after the start, or an end equal to the start — which
 * the form refuses as an empty range rather than a 24-hour lesson.
 */
export function nextDayRangeOf(
  date: string | undefined,
  startTime: string | undefined,
  endTime: string | undefined,
  timeZone: string,
): { startsAt: string; endsAt: string } | undefined {
  if (startTime === endTime) return undefined
  const range = rangeOf(date, startTime, endTime, timeZone)
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

/**
 * The value a day filter of the two lessons lists keeps (DateFilter — J-F25): a
 * real `YYYY-MM-DD` day, else undefined. A malformed value reaches the filter
 * only from a browser that renders the date input as a plain text field; kept,
 * it would count as a narrowing filter while the request sends nothing.
 */
export function dateFilterValue(raw: string): string | undefined {
  return isCalendarDate(raw) ? raw : undefined
}

/** The first instant of a calendar day in `timeZone` as ISO 8601 (the `from` filter), or undefined for a blank or malformed input. */
export function dayStartInstant(date: string | undefined, timeZone: string): string | undefined {
  return toInstant(date, '00:00', timeZone)
}

/**
 * The last millisecond of a calendar day in `timeZone` as ISO 8601 (the `to`
 * filter — the server compares inclusively): one before the next day starts,
 * so a 23- or 25-hour day (DST) keeps its whole length.
 */
export function dayEndInstant(date: string | undefined, timeZone: string): string | undefined {
  if (!date || !isCalendarDate(date)) return undefined
  return new Date(zonedInstant(addDays(date, 1), '00:00', timeZone) - 1).toISOString()
}

function intlLocale(language: Language): string {
  // Arabic with Latin digits, as users.format.ts: times line up with the identifiers around them.
  return language === 'ar' ? 'ar-u-nu-latn' : 'en-GB'
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** A formatter in `timeZone` — an unknown name reads as UTC, as zonedInstant() does, so what is shown and what is typed agree. */
function formatter(language: Language, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const zone = isTimeZone(timeZone) ? timeZone : 'UTC'
  const key = `${language}|${zone}|${JSON.stringify(options)}`
  let value = formatters.get(key)
  if (!value) {
    value = new Intl.DateTimeFormat(intlLocale(language), { ...options, timeZone: zone })
    formatters.set(key, value)
  }
  return value
}

/** `HH:MM` (24 h, Latin digits) of an instant on the wall clock of `timeZone`. */
export function formatClock(iso: string, language: Language, timeZone: string): string {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return iso
  return formatter(language, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value)
}

/** `10:00 – 11:30` in `timeZone` (render it in a plain `dir="ltr"` span); a lesson ending on another day of that zone shows NEXT_DAY_MARK. */
export function formatLessonTimes(startsAt: string, endsAt: string, language: Language, timeZone: string): string {
  const start = zonedPartsOf(startsAt, timeZone)
  const end = zonedPartsOf(endsAt, timeZone)
  const range = `${formatClock(startsAt, language, timeZone)} – ${formatClock(endsAt, language, timeZone)}`
  return start.date === end.date || !end.date ? range : `${range} ${NEXT_DAY_MARK}`
}

/** The lesson's day in `timeZone`, localized (medium date style). */
export function formatLessonDay(iso: string, language: Language, timeZone: string): string {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return iso
  return formatter(language, timeZone, { dateStyle: 'medium' }).format(value)
}

/**
 * A timestamp of the lesson — its creation, its last change, when its
 * attendance was recorded — in `timeZone`, styled as users.format's
 * formatDateTime (medium date, short time): every time a lesson screen shows
 * is in the lesson's zone, so its zone hint holds for all of them. A missing
 * value shows a dash.
 */
export function formatLessonDateTime(iso: string | null | undefined, language: Language, timeZone: string): string {
  if (!iso) return EMPTY
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return iso
  return formatter(language, timeZone, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
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
