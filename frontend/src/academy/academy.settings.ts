// Weekly-schedule keys of `academy.settings` (J-F02 on MOD-02-T03, API-035/036).
// Mirrors backend/src/academy/academy.settings.ts: weekdays 0 = Sunday … 6 =
// Saturday, working days 1–7 distinct and stored ascending, `null` = not set (no
// country-bound default). The form shows "not set" as an empty choice; this
// module turns it into the smallest `settings.scheduling` PATCH, key by key:
// an unchanged key is left out, a cleared one becomes `null`.
import type { AcademySettingsInput, SchedulingSettings, Weekday } from '../api/academy'

/** 0 = Sunday … 6 = Saturday. */
export const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6]

/** Translation keys under `settings.weekdays.*`, indexed by weekday. */
export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export type SchedulingPatch = NonNullable<AcademySettingsInput['scheduling']>

/** The weekly-schedule part of the settings form. */
export interface SchedulingFormValues {
  /** `undefined` (a cleared select) = not set. */
  weekStartsOn?: Weekday
  /** No day checked = not set. */
  workingDays?: Weekday[]
}

export function isWeekday(value: unknown): value is Weekday {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
}

/** Initial form values from the loaded settings (`null` → an empty choice). */
export function schedulingFormValuesOf(settings: SchedulingSettings): SchedulingFormValues {
  return { weekStartsOn: settings.weekStartsOn ?? undefined, workingDays: settings.workingDays ?? [] }
}

/** The days as the server stores them: distinct, ascending; none → `null` (an empty list is refused by the server). */
export function normaliseWorkingDays(days: readonly number[] | null | undefined): Weekday[] | null {
  const unique = [...new Set((days ?? []).filter(isWeekday))].sort((a, b) => a - b)
  return unique.length === 0 ? null : unique
}

export function sameDays(a: readonly Weekday[] | null, b: readonly Weekday[] | null): boolean {
  if (a === null || b === null) return a === b
  return a.length === b.length && a.every((day, index) => day === b[index])
}

/** The seven days starting from the first day of the week (Sunday when it is not set). */
export function orderedWeekdays(start: Weekday | null | undefined): Weekday[] {
  const first = isWeekday(start) ? start : 0
  return WEEKDAYS.map((_, offset) => ((first + offset) % 7) as Weekday)
}

/** The `settings.scheduling` PATCH that moves `current` to `values`, or `null` when nothing differs. */
export function planSchedulingPatch(current: SchedulingSettings, values: SchedulingFormValues): SchedulingPatch | null {
  const patch: SchedulingPatch = {}

  const weekStartsOn = isWeekday(values.weekStartsOn) ? values.weekStartsOn : null
  if (weekStartsOn !== current.weekStartsOn) patch.weekStartsOn = weekStartsOn

  const workingDays = normaliseWorkingDays(values.workingDays)
  if (!sameDays(workingDays, normaliseWorkingDays(current.workingDays))) patch.workingDays = workingDays

  return Object.keys(patch).length === 0 ? null : patch
}
