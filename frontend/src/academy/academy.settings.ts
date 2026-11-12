// Weekly-schedule keys of `academy.settings` (J-F02 on MOD-02-T03, API-035/036).
// Mirrors backend/src/academy/academy.settings.ts: weekdays 0 = Sunday … 6 =
// Saturday, working days 1–7 distinct and stored ascending, `null` = not set (no
// country-bound default). The form shows "not set" as an empty choice; this
// module turns it into the smallest `settings.scheduling` PATCH, key by key:
// an unchanged key is left out, a cleared one becomes `null`. Since J-F51 also
// the certificates key `settings.certificates.serialPrefix` (MOD-10-T02,
// D-R51) — the same rules, in the same single PATCH (at the end of this file).
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

// --- Certificates (J-F51 on MOD-10-T02, D-R51) ---

/** Mirror of `serialPrefixSchema` (backend/src/academy/academy.settings.ts — keep in sync): 2–10 upper-case letters or digits. */
export const SERIAL_PREFIX_PATTERN = /^[A-Z0-9]{2,10}$/
export const SERIAL_PREFIX_MAX_LENGTH = 10
/** The prefix the server uses while the academy has set none (`DEFAULT_CERTIFICATE_SERIAL_PREFIX`). */
export const DEFAULT_CERTIFICATE_SERIAL_PREFIX = 'CERT'

export type CertificatesPatch = NonNullable<AcademySettingsInput['certificates']>

/** The prefix as it is sent: trimmed and upper-cased (`aca` → `ACA`); blank = not set. */
export function normaliseSerialPrefix(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

/** True for a blank field (= not set, the default `CERT`) or a prefix the server accepts once normalised. */
export function isSerialPrefixInput(value: string | null | undefined): boolean {
  const prefix = normaliseSerialPrefix(value)
  return prefix === '' || SERIAL_PREFIX_PATTERN.test(prefix)
}

/**
 * The stored prefix, read defensively: a server before MOD-10-T02 (CH-0176)
 * sends no `settings.certificates`, and anything that is not a valid prefix
 * reads as not set — as the server's lenient `readSettings()` reads it.
 */
export function serialPrefixOf(settings: unknown): string | null {
  const certificates = typeof settings === 'object' && settings !== null ? (settings as { certificates?: unknown }).certificates : undefined
  const prefix = typeof certificates === 'object' && certificates !== null ? (certificates as { serialPrefix?: unknown }).serialPrefix : undefined
  return typeof prefix === 'string' && SERIAL_PREFIX_PATTERN.test(prefix) ? prefix : null
}

/**
 * The `settings.certificates` PATCH that moves `current` to the typed prefix
 * (a blank field clears it), or `null` when nothing differs — and for a form
 * without the field at all (`undefined`), which changes nothing.
 */
export function planCertificatesPatch(current: string | null, value: string | null | undefined): CertificatesPatch | null {
  if (value === undefined) return null
  const typed = normaliseSerialPrefix(value)
  const next = typed === '' ? null : typed
  return next === current ? null : { serialPrefix: next }
}

/** The first serial of a year with this prefix — the default one while the field is blank or not valid yet (`ACA-2026-00001`). */
export function exampleSerial(value: string | null | undefined, year: number): string {
  const typed = normaliseSerialPrefix(value)
  const prefix = SERIAL_PREFIX_PATTERN.test(typed) ? typed : DEFAULT_CERTIFICATE_SERIAL_PREFIX
  return `${prefix}-${year}-00001`
}
