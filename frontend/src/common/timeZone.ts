// The time-zone helpers of every screen that shows and types times in a named
// IANA zone (D-R41): lessons (J-F28, J-F48), assignments (J-F38) and exams
// (J-F45). One home since J-F48 (the owner's note 3 on #105) for what those
// screens had copied with diverging behaviour: the academy's zone of GET
// /api/academy (API-035 `timezone`), the one comparison of two zone names — an
// alias (Etc/UTC, Asia/Calcutta) is the zone it stands for, so a lesson in
// `Etc/UTC` names no zone on a device in `UTC` — and the wall-clock conversions
// of the native date and time inputs, through the timetable's zonedInstant()
// (DST-safe, a mirror of the server's: a time a DST gap skips moves forward by
// the gap). lessons/lessons.format.ts and assignments/assignments.zone.ts
// re-export these under the names they had. Pure; unit-tested in
// timeZone.test.ts.
import { addDays, calendarDateIn, clockOfMinutes, isCalendarDate, isTimeZone, minutesNowIn, zonedInstant } from '../timetable/timetable.dates'
import { deviceTimeZone } from '../timetable/timetable.settings'

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** The academy's IANA zone from the GET /api/academy body (`timezone`), or null when it is unknown. */
export function academyTimeZoneOf(academy: { timezone?: unknown } | null | undefined): string | null {
  const zone = academy?.timezone
  return isTimeZone(zone) ? zone : null
}

const canonicalZones = new Map<string, string>()

/** The name Intl resolves a zone to, so an alias compares equal to the name it stands for; an unknown name stays itself. */
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

/** True when the two names denote one zone (UTC = Etc/UTC, Asia/Kolkata = Asia/Calcutta). */
export function sameTimeZone(a: string, b: string): boolean {
  return a === b || canonicalZone(a) === canonicalZone(b)
}

/** True when `zone` is not this device's zone: the screens then name the zone beside the time (D-R41). */
export function differsFromDevice(zone: string, deviceZone: string = deviceTimeZone()): boolean {
  return !sameTimeZone(zone, deviceZone)
}

/** The instant as the calendar date and `HH:MM` wall clock of `zone` (the values of the native inputs); empty for a malformed instant. */
export function wallClockIn(iso: string, zone: string): { date: string; time: string } {
  const instant = Date.parse(iso)
  if (Number.isNaN(instant)) return { date: '', time: '' }
  return { date: calendarDateIn(zone, instant), time: clockOfMinutes(minutesNowIn(zone, instant)) }
}

/**
 * A calendar date and an `HH:MM` wall clock of `zone` → ISO 8601 instant (UTC,
 * `Z`), or undefined when either is missing or malformed. A time a DST gap
 * skips moves forward; one that occurs twice resolves as zonedInstant() says.
 */
export function instantIn(date: string | undefined, time: string | undefined, zone: string): string | undefined {
  if (!date || !time || !isCalendarDate(date) || !CLOCK_TIME.test(time)) return undefined
  return new Date(zonedInstant(date, time, zone)).toISOString()
}

/** The first instant of a calendar day of `zone` (a «from» filter), or undefined for a blank or malformed day. */
export function dayStartIn(day: string | undefined, zone: string): string | undefined {
  return instantIn(day, '00:00', zone)
}

/**
 * The last millisecond of a calendar day of `zone` (a «to» filter — the server
 * compares inclusively): one before the next day starts, so a 23- or 25-hour
 * day (DST) keeps its whole length.
 */
export function dayEndIn(day: string | undefined, zone: string): string | undefined {
  if (!day || !isCalendarDate(day)) return undefined
  return new Date(zonedInstant(addDays(day, 1), '00:00', zone) - 1).toISOString()
}
