// Time zones of the assignment screens (J-F38, D-R41). Every instant of an
// assignment is shown in its `timeZone`, the zone the server derives: the
// linked lesson's room branch when the branch has one, else the academy's. A
// due date is typed as a calendar date and a wall-clock time and sent as an
// instant, converted with the timetable's zonedInstant() (DST-safe: a time a
// DST gap skips lands next to the gap, a repeated time on its first
// occurrence). The zone the form types in (dueZoneOf()) is the zone the
// assignment will have once the server has it, known without a new request:
//
//   1. an existing assignment whose lesson link the form keeps: its `timeZone`;
//   2. a lesson chosen in the form (a new assignment, or another lesson in an
//      edit): that lesson's `timeZone` from the API-093 list the lesson select
//      has already read — LessonDto carries the same D-R41 zone since CH-0114;
//   3. no lesson, or a lesson whose zone is unknown: the academy's zone from
//      the shared GET /api/academy read (useAcademy());
//   4. the academy could not be read: this device's zone, which the hint says.
//
// The list's due-date filter reads its calendar days in the academy's zone
// (this device's until it is known). Pure; unit-tested in
// assignments.zone.test.ts.
import { addDays, calendarDateIn, clockOfMinutes, isCalendarDate, isTimeZone, minutesNowIn, zonedInstant } from '../timetable/timetable.dates'
import { deviceTimeZone } from '../timetable/timetable.settings'

/** Where the form's zone comes from — the hint words each one. */
export type DueZoneSource = 'assignment' | 'lesson' | 'academy' | 'device'

export interface DueZone {
  zone: string
  source: DueZoneSource
}

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** The academy's IANA zone from the GET /api/academy body, or null when it is unknown. */
export function academyZoneOf(academy: { timezone?: unknown } | null | undefined): string | null {
  const zone = academy?.timezone
  return isTimeZone(zone) ? zone : null
}

/**
 * The display zone of a lesson of API-093 (`timeZone`, D-R41 since CH-0114),
 * read defensively: the lessons client of the frontend may not declare it.
 */
export function lessonZoneOf(lesson: unknown): string | null {
  if (typeof lesson !== 'object' || lesson === null) return null
  const zone = (lesson as { timeZone?: unknown }).timeZone
  return isTimeZone(zone) ? zone : null
}

export interface DueZoneInput {
  /** The lesson the form links (empty = none). */
  lessonId: string | undefined
  /** That lesson's zone when the lesson select knows it. */
  lessonZone: string | null
  /** Edit only: the assignment as the server holds it. */
  current?: { lessonId: string | null; timeZone: string }
  academyZone: string | null
  /** This device's zone (a parameter for the tests). */
  deviceZone?: string
}

/** The zone the form's due date is typed in: the zone the server will give the assignment (rules 1–4 above). */
export function dueZoneOf({ lessonId, lessonZone, current, academyZone, deviceZone = deviceTimeZone() }: DueZoneInput): DueZone {
  const linked = lessonId || null
  if (current && linked === current.lessonId && isTimeZone(current.timeZone)) return { zone: current.timeZone, source: 'assignment' }
  if (linked && lessonZone) return { zone: lessonZone, source: 'lesson' }
  if (academyZone) return { zone: academyZone, source: 'academy' }
  return { zone: deviceZone, source: 'device' }
}

/** True when `zone` is not this device's zone — the screens then name the zone beside the time. */
export function differsFromDevice(zone: string, deviceZone: string = deviceTimeZone()): boolean {
  return zone !== deviceZone
}

/** The instant as the calendar date and `HH:MM` wall clock of `zone` (the values of the native inputs); empty for a malformed instant. */
export function wallClockIn(iso: string, zone: string): { date: string; time: string } {
  const instant = Date.parse(iso)
  if (Number.isNaN(instant)) return { date: '', time: '' }
  return { date: calendarDateIn(zone, instant), time: clockOfMinutes(minutesNowIn(zone, instant)) }
}

/** A calendar date and an `HH:MM` wall clock of `zone` → ISO 8601 instant (UTC, `Z`), or undefined when either is missing or malformed. */
export function instantIn(date: string | undefined, time: string | undefined, zone: string): string | undefined {
  if (!date || !time || !isCalendarDate(date) || !CLOCK_TIME.test(time)) return undefined
  return new Date(zonedInstant(date, time, zone)).toISOString()
}

/** The first instant of a calendar day of `zone` (the `dueFrom` filter), or undefined for a blank or malformed day. */
export function dayStartIn(day: string | undefined, zone: string): string | undefined {
  return instantIn(day, '00:00', zone)
}

/** The last millisecond of a calendar day of `zone` (the `dueTo` filter — the server compares inclusively); a 23- or 25-hour day included. */
export function dayEndIn(day: string | undefined, zone: string): string | undefined {
  if (!day || !isCalendarDate(day)) return undefined
  return new Date(zonedInstant(addDays(day, 1), '00:00', zone) - 1).toISOString()
}
