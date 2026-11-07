// The academy settings the timetable reads (J-F08): its time zone (API-035
// `timezone`) and the weekly-schedule keys `settings.scheduling.weekStartsOn`
// and `settings.scheduling.workingDays` (MOD-02-T03). They are read
// defensively from the GET /api/academy body — the frontend `Academy` type
// gains `settings` with J-F02 (#32), so this module accepts any shape — and a
// missing or `null` key falls back as the backend documents (no country-bound
// default): the week starts on Sunday, as J-F02 and J-F05 show "not set", and
// no day is excluded. Pure; unit-tested in timetable.settings.test.ts.
import { isTimeZone } from './timetable.dates'

export interface TimetableSettings {
  /** IANA zone of "today" and "now" (the academy's; this device's when it could not be read). */
  timeZone: string
  /** 0 = Sunday … 6 = Saturday. */
  weekStartsOn: number
  /** Ascending and distinct; null = not set (every day may hold slots). */
  workingDays: number[] | null
}

export const DEFAULT_WEEK_STARTS_ON = 0

function isWeekday(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** This device's zone (the fallback when the academy could not be read). */
export function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isTimeZone(zone) ? zone : 'UTC'
  } catch {
    return 'UTC'
  }
}

/** `academy` = the GET /api/academy body, or null when it could not be read. */
export function timetableSettingsOf(academy: { timezone?: unknown; settings?: unknown } | null): TimetableSettings {
  const scheduling = objectOf(objectOf(academy?.settings)?.scheduling)
  const start = scheduling?.weekStartsOn
  const days: unknown = scheduling?.workingDays
  const zone = academy?.timezone
  return {
    timeZone: isTimeZone(zone) ? zone : deviceTimeZone(),
    weekStartsOn: isWeekday(start) ? start : DEFAULT_WEEK_STARTS_ON,
    workingDays: Array.isArray(days) && days.length > 0 && days.every(isWeekday) ? [...new Set(days)].sort((a, b) => a - b) : null,
  }
}
