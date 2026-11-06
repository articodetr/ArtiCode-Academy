// Scheduling settings of the academy (MOD-02-T03 — `settings.scheduling.weekStartsOn`
// and `workingDays`), read defensively from the body of GET /api/academy so this
// screen does not depend on the typed `settings` field of the academy client
// (J-F02 adds it). An absent or unreadable value reads as null: no restriction
// on the working days (D-R28) and the server's weekday numbering (Sunday first).
export interface SchedulingSettingsView {
  /** First day of the week in the editor and the weekly view; null = not set. */
  weekStartsOn: number | null
  /** Distinct weekdays 0–6 in ascending order; null = every day is allowed. */
  workingDays: number[] | null
}

export const NO_SCHEDULING_SETTINGS: Readonly<SchedulingSettingsView> = Object.freeze({ weekStartsOn: null, workingDays: null })

function isWeekday(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
}

/** `settings.scheduling` of an academy body of any shape (the pure part, unit-tested). */
export function schedulingSettingsOf(academy: unknown): SchedulingSettingsView {
  const settings = typeof academy === 'object' && academy !== null ? (academy as { settings?: unknown }).settings : undefined
  const scheduling = typeof settings === 'object' && settings !== null ? (settings as { scheduling?: unknown }).scheduling : undefined
  if (typeof scheduling !== 'object' || scheduling === null) return { ...NO_SCHEDULING_SETTINGS }
  const { weekStartsOn, workingDays } = scheduling as { weekStartsOn?: unknown; workingDays?: unknown }
  const days = Array.isArray(workingDays) && workingDays.length > 0 && workingDays.every(isWeekday) ? [...new Set(workingDays)].sort((a, b) => a - b) : null
  return { weekStartsOn: isWeekday(weekStartsOn) ? weekStartsOn : null, workingDays: days }
}
