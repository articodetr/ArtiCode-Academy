// Pure helpers of the lessons screens (J-F09): instants ↔ the native date and
// time inputs, the range rule of lessons.time.ts, and the labels the list and
// the drawer render. Every wall-clock value here belongs to a named IANA zone
// (D-R41 — J-F28): a lesson's own `timeZone` (its room's branch, else the
// academy's — the server decides) for its times, shown and typed; for a lesson
// typed with another room, or not created yet, the zone the server will give
// it — the chosen room's `timeZone` (RoomDto since CH-0189), else the
// academy's (lessonZoneFor() — J-F48); the academy's for «today» and the day
// filters. The browser's zone is read in one place only, deviceTimeZone(),
// which the screens name beside a lesson zone that differs from it. The
// academy's zone, the zone comparison and the wall-clock conversions are the
// shared ones of common/timeZone.ts (J-F48), re-exported here under their
// names; they go through the timetable's zonedInstant() (DST-safe, a mirror of
// the server's). No React, no i18next instance.
import { MAX_LESSON_HOURS } from '../api/lessons'
import type { Lesson } from '../api/lessons'
import type { ScheduleRoom } from '../api/timetable'
import { academyTimeZoneOf, dayEndIn, dayStartIn, differsFromDevice, instantIn, sameTimeZone, wallClockIn } from '../common/timeZone'
import type { Language } from '../i18n/language'
import { addDays, calendarDateIn, isCalendarDate, isTimeZone } from '../timetable/timetable.dates'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { localizedLabel } from '../users/users.format'

const EMPTY = '—'

/** The mark of an end on the next day, after the end time (list, drawer and the form's end time — J-F19). */
export const NEXT_DAY_MARK = '(+1)'

/** Where the zone of the shown or typed times comes from — the screens say it beside the zone's name. */
export type LessonZoneSource = 'lesson' | 'room' | 'academy' | 'device'

export interface LessonZone {
  /** IANA name. */
  timeZone: string
  /**
   * `lesson` = the lesson's own (D-R41); `room` = the chosen room's (RoomDto `timeZone` — J-F48); `academy` = API-035
   * `timezone`; `device` = this device's, when the academy could not be read.
   */
  source: LessonZoneSource
}

/**
 * The academy's zone (API-035 `timezone`) — the zone of «today», of the day
 * filters and of the times typed for a lesson without a room — or this
 * device's when the academy could not be read (as the timetable falls back).
 */
export function academyZoneOf(academy: { timezone?: unknown } | null): LessonZone {
  const zone = academyTimeZoneOf(academy)
  return zone ? { timeZone: zone, source: 'academy' } : { timeZone: deviceTimeZone(), source: 'device' }
}

/**
 * The zone the server will give a lesson held in `room` (D-R41 — a manual
 * mirror of `displayTimeZone()` in backend/src/schedule/timetable.policy.ts,
 * which LessonsService applies — keep them in sync): the room's `timeZone` (RoomDto since CH-0189 — its
 * branch's, else the academy's, by the same function), else — no room, or a
 * room read without a zone — `academy` (useAcademyZone(): this device's when
 * the academy could not be read). The lesson forms type the day and the times
 * in it (J-F48), so a lesson typed at 10:00 in a Berlin room is 10:00 in
 * Berlin, as the weekly slot at 10:00 in that room generates it.
 */
export function lessonZoneFor(room: { timeZone?: unknown } | null | undefined, academy: LessonZone): LessonZone {
  const zone = room?.timeZone
  return isTimeZone(zone) ? { timeZone: zone, source: 'room' } : academy
}

// The shared comparison (an alias is the zone it stands for) and conversions, under the names the lessons screens use.
export { differsFromDevice, sameTimeZone }
/** The instant as `YYYY-MM-DD` and `HH:MM` on the wall clock of `timeZone` (the values of the native inputs). */
export { wallClockIn as zonedPartsOf }
/** A wall-clock date and time in `timeZone` → ISO 8601 instant (UTC, `Z`), or undefined when either is missing or malformed. */
export { instantIn as toInstant }

/** Today in `timeZone` as `YYYY-MM-DD` — the default «from» of the lessons list (the academy's day — D-R41). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return calendarDateIn(timeZone, now.getTime())
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
  const startsAt = instantIn(date, startTime, timeZone)
  const sameDayEnd = instantIn(date, endTime, timeZone)
  if (!date || !startsAt || !sameDayEnd) return undefined
  const nextDay = new Date(sameDayEnd).getTime() <= new Date(startsAt).getTime()
  const endsAt = nextDay ? instantIn(addDays(date, 1), endTime, timeZone) : sameDayEnd
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
export { dayStartIn as dayStartInstant }
/** The last millisecond of a calendar day in `timeZone` as ISO 8601 (the `to` filter, inclusive); a 23- or 25-hour day keeps its whole length. */
export { dayEndIn as dayEndInstant }

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
  const start = wallClockIn(startsAt, timeZone)
  const end = wallClockIn(endsAt, timeZone)
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
