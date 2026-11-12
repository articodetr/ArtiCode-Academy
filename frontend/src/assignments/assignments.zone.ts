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
// assignments.zone.test.ts. Since J-F48 the academy's zone, the comparison
// with this device's zone (an alias now equals the zone it stands for: Etc/UTC
// is UTC) and the wall-clock conversions are the shared ones of
// common/timeZone.ts, re-exported below under the names this module had.
import { isTimeZone } from '../timetable/timetable.dates'
import { deviceTimeZone } from '../timetable/timetable.settings'

export { academyTimeZoneOf as academyZoneOf, dayEndIn, dayStartIn, differsFromDevice, instantIn, wallClockIn } from '../common/timeZone'

/** Where the form's zone comes from — the hint words each one. */
export type DueZoneSource = 'assignment' | 'lesson' | 'academy' | 'device'

export interface DueZone {
  zone: string
  source: DueZoneSource
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
