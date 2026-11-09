// Calendar arithmetic of the timetable (J-F08), pure and unit-tested in
// timetable.dates.test.ts. A calendar date is a `YYYY-MM-DD` string — the
// shape the API exchanges (`on`, `effectiveFrom`, `effectiveTo`) — computed on
// UTC midnights, so neither the browser's zone nor a DST change shifts a day.
// Weekdays follow the server: 0 = Sunday … 6 = Saturday. A wall-clock time
// (`HH:MM`) belongs to an IANA zone: the academy's for "today" and "now"
// (as the server's default `on`), the slot's own `timeZone` for its times.

/** `YYYY-MM-DD`. */
export type CalendarDate = string

/** A month of the calendar; `month` is 1–12. */
export interface CalendarMonth {
  year: number
  month: number
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function utcOf(date: CalendarDate): Date {
  const match = CALENDAR_DATE.exec(date)
  if (!match) throw new RangeError(`Not a calendar date: ${date}`)
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

function dateOfUtc(value: Date): CalendarDate {
  return value.toISOString().slice(0, 10)
}

/** A real `YYYY-MM-DD` date (2026-02-30 is not). */
export function isCalendarDate(value: unknown): value is CalendarDate {
  return typeof value === 'string' && CALENDAR_DATE.test(value) && dateOfUtc(utcOf(value)) === value
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const value = utcOf(date)
  value.setUTCDate(value.getUTCDate() + days)
  return dateOfUtc(value)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: CalendarDate): number {
  return utcOf(date).getUTCDay()
}

export function normaliseWeekday(value: number): number {
  return ((value % 7) + 7) % 7
}

/** The first day of the week holding `date`, for a week that starts on `weekStartsOn`. */
export function startOfWeek(date: CalendarDate, weekStartsOn: number): CalendarDate {
  return addDays(date, -normaliseWeekday(weekdayOf(date) - weekStartsOn))
}

/**
 * The date of `weekday` in the week (starting on `weekStartsOn`) that holds
 * `date` — where the weekday filter of the academy schedule puts a selection,
 * so the day shown is always a day the filter shows (J-F18).
 */
export function weekdayInWeek(date: CalendarDate, weekday: number, weekStartsOn: number): CalendarDate {
  return addDays(startOfWeek(date, weekStartsOn), normaliseWeekday(weekday - weekStartsOn))
}

/** `count` consecutive dates starting at `date`. */
export function datesFrom(date: CalendarDate, count: number): CalendarDate[] {
  return Array.from({ length: count }, (_, index) => addDays(date, index))
}

/** The seven dates of the week holding `date`, in order. */
export function weekDatesOf(date: CalendarDate, weekStartsOn: number): CalendarDate[] {
  return datesFrom(startOfWeek(date, weekStartsOn), 7)
}

export function monthOf(date: CalendarDate): CalendarMonth {
  const value = utcOf(date)
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1 }
}

export function addMonths(month: CalendarMonth, delta: number): CalendarMonth {
  const index = month.year * 12 + (month.month - 1) + delta
  return { year: Math.floor(index / 12), month: normaliseMonthIndex(index) + 1 }
}

function normaliseMonthIndex(index: number): number {
  return ((index % 12) + 12) % 12
}

export function firstOfMonth(month: CalendarMonth): CalendarDate {
  return `${String(month.year).padStart(4, '0')}-${pad(month.month)}-01`
}

export function daysInMonth(month: CalendarMonth): number {
  return new Date(Date.UTC(month.year, month.month, 0)).getUTCDate()
}

export function sameMonth(date: CalendarDate, month: CalendarMonth): boolean {
  const of = monthOf(date)
  return of.year === month.year && of.month === month.month
}

/**
 * The month as rows of seven cells starting on `weekStartsOn`; `null` pads
 * the cells before the 1st and after the last day (4–6 rows).
 */
export function monthRows(month: CalendarMonth, weekStartsOn: number): Array<Array<CalendarDate | null>> {
  const first = firstOfMonth(month)
  const lead = normaliseWeekday(weekdayOf(first) - weekStartsOn)
  const cells: Array<CalendarDate | null> = [...Array.from({ length: lead }, () => null), ...datesFrom(first, daysInMonth(month))]
  while (cells.length % 7 !== 0) cells.push(null)
  const rows: Array<Array<CalendarDate | null>> = []
  for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7))
  return rows
}

/** Minutes since midnight of an `HH:MM` clock time. */
export function clockMinutes(time: string): number {
  const match = CLOCK_TIME.exec(time)
  if (!match) throw new RangeError(`Not a clock time: ${time}`)
  return Number(match[1]) * 60 + Number(match[2])
}

/** `HH:MM` of minutes since midnight (24:00 for the end of the day). */
export function clockOfMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/** True when `value` names a time zone this browser knows. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const zonedFormatters = new Map<string, Intl.DateTimeFormat>()

function zonedParts(instant: number, timeZone: string): ZonedParts {
  const zone = isTimeZone(timeZone) ? timeZone : 'UTC'
  let formatter = zonedFormatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    zonedFormatters.set(zone, formatter)
  }
  const parts = formatter.formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((candidate) => candidate.type === type)?.value ?? 0)
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour') % 24, minute: part('minute'), second: part('second') }
}

/** The calendar date of `now` in `timeZone` — the server's default `on`. An unknown zone reads as UTC. */
export function calendarDateIn(timeZone: string, now: number = Date.now()): CalendarDate {
  const parts = zonedParts(now, timeZone)
  return `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}`
}

/** Minutes since midnight of the wall clock in `timeZone` at `now`. */
export function minutesNowIn(timeZone: string, now: number = Date.now()): number {
  const parts = zonedParts(now, timeZone)
  return parts.hour * 60 + parts.minute
}

/** Wall-clock minus UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = zonedParts(instant, timeZone)
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return wall - (instant - (((instant % 1000) + 1000) % 1000))
}

/**
 * The instant (epoch ms) of a wall-clock time on a calendar date in a zone:
 * 10:00 on 2026-11-08 in Asia/Riyadh is 07:00Z. A manual mirror of
 * `zonedInstant()` in backend/src/schedule/lesson-generation.plan.ts — keep
 * them in sync — so a slot's occurrence here, a lesson the server generates
 * from it and a time typed in the lesson forms (D-R41 — J-F28) are the same
 * instant. Two offset probes settle the ordinary case and both sides of a
 * daylight-saving change: a time a DST gap skips moves forward by the gap
 * (02:30 → 03:30 in Europe/Berlin and in America/New_York); a time that
 * occurs twice resolves as the probes settle it — the later occurrence east of
 * UTC (02:30 CET in Europe/Berlin), the first one west of it (01:30 EDT in
 * America/New_York), as on the server.
 */
export function zonedInstant(date: CalendarDate, time: string, timeZone: string): number {
  const wall = utcOf(date).getTime() + clockMinutes(time) * 60_000
  const first = wall - offsetAt(wall, timeZone)
  const offsetAtFirst = offsetAt(first, timeZone)
  const second = wall - offsetAtFirst
  if (second === first) return first
  if (offsetAt(second, timeZone) === offsetAtFirst) return second
  // A gap: neither probe round-trips — the later instant (the wall time moved forward by the gap).
  return Math.max(first, second)
}
