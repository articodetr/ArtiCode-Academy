// Mirror of backend/src/grades/grade-schemes.changes.ts (MOD-09-T02, owner
// decision D-R46) — keep in sync: the same rules, the same order of problems,
// the same smallest update. The screen applies them before any request, so the
// server's `400 grade_scheme_invalid` and `409 grade_scheme_is_default` stay
// the backstop. `bandOf()` (the band a percentage falls in) is not mirrored:
// the frontend computes no grade — the numbers come from the server.
//
//   bands     a band covers the percentages from its minimum up to the next
//             band's; a scheme needs a band at 0, distinct minimums, at least
//             one passing band, and every band above a passing one passes
//   update    the smallest change: name, the whole band list (compared in
//             canonical order), isDefault (promotion only), isActive
import type { LocalizedLabel } from '../api/users'
import { sameLabel } from '../courses/courses.form'

/** The band rules a grade scheme breaks — the `problems` of `400 grade_scheme_invalid`, in the order the server lists them. */
export type GradeSchemeProblem = 'no_zero_band' | 'duplicate_min_percent' | 'no_passing_band' | 'pass_not_ascending'

export const GRADE_SCHEME_PROBLEMS: readonly GradeSchemeProblem[] = ['no_zero_band', 'duplicate_min_percent', 'no_passing_band', 'pass_not_ascending']

/** The `action` of `409 grade_scheme_is_default`. */
export type DefaultSchemeAction = 'deactivate' | 'delete' | 'unset_default' | 'promote_inactive'

export interface SchemeBand {
  /** Two decimals as text (numeric(5,2)), e.g. "60.00". */
  minPercent: string
  label: LocalizedLabel
  letter: string | null
  isPass: boolean
}

/** numeric(5,2) text of a percentage. */
export function percentText(value: number | string): string {
  return Number(value).toFixed(2)
}

/** Bands in ascending order of their minimum. */
export function sortBands<T extends { minPercent: string }>(bands: readonly T[]): T[] {
  return [...bands].sort((a, b) => Number(a.minPercent) - Number(b.minPercent))
}

export interface BandCheck {
  problems: GradeSchemeProblem[]
  /** Minimums that appear more than once. */
  duplicates: number[]
}

/** The rules a band list breaks; empty problems = valid. */
export function checkBands(bands: readonly SchemeBand[]): BandCheck {
  const problems: GradeSchemeProblem[] = []
  const counts = new Map<string, number>()
  for (const band of bands) counts.set(band.minPercent, (counts.get(band.minPercent) ?? 0) + 1)
  const duplicates = [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([min]) => Number(min))
    .sort((a, b) => a - b)
  if (!counts.has(percentText(0))) problems.push('no_zero_band')
  if (duplicates.length > 0) problems.push('duplicate_min_percent')
  if (!bands.some((band) => band.isPass)) problems.push('no_passing_band')
  const sorted = sortBands(bands)
  const firstPass = sorted.findIndex((band) => band.isPass)
  if (firstPass >= 0 && sorted.slice(firstPass).some((band) => !band.isPass)) problems.push('pass_not_ascending')
  return { problems, duplicates }
}

function sameBand(a: SchemeBand, b: SchemeBand): boolean {
  return a.minPercent === b.minPercent && sameLabel(a.label, b.label) && a.letter === b.letter && a.isPass === b.isPass
}

/** Same bands in canonical (ascending) order. */
export function sameBands(a: readonly SchemeBand[], b: readonly SchemeBand[]): boolean {
  if (a.length !== b.length) return false
  const left = sortBands(a)
  const right = sortBands(b)
  return left.every((band, index) => sameBand(band, right[index]!))
}

export interface CurrentScheme {
  name: LocalizedLabel
  isDefault: boolean
  isActive: boolean
  bands: SchemeBand[]
}

export interface SchemePatch {
  name?: LocalizedLabel
  bands?: SchemeBand[]
  isDefault?: boolean
  isActive?: boolean
}

export interface SchemeUpdatePlan {
  /** The changed fields in a stable order. */
  fields: ('name' | 'bands' | 'isDefault' | 'isActive')[]
  name?: LocalizedLabel
  bands?: SchemeBand[]
  isActive?: boolean
  /** True when this scheme becomes the default (the previous default steps down). */
  promotes: boolean
  /** Set when the change breaks the "one active default" rule. */
  refusal?: DefaultSchemeAction
}

/**
 * The smallest update of a scheme. `isDefault: false` on the default is a
 * refusal (another scheme must be promoted); on any other scheme it changes
 * nothing. The default stays active, and an inactive scheme is promoted only
 * together with its activation.
 */
export function planGradeSchemeUpdate(current: CurrentScheme, patch: SchemePatch): SchemeUpdatePlan {
  const plan: SchemeUpdatePlan = { fields: [], promotes: false }
  if (patch.name !== undefined && !sameLabel(patch.name, current.name)) {
    plan.fields.push('name')
    plan.name = patch.name
  }
  if (patch.bands !== undefined && !sameBands(patch.bands, current.bands)) {
    plan.fields.push('bands')
    plan.bands = sortBands(patch.bands)
  }
  const nextActive = patch.isActive ?? current.isActive
  if (patch.isDefault === false && current.isDefault) return { ...plan, refusal: 'unset_default' }
  const nextDefault = patch.isDefault === true ? true : current.isDefault
  if (nextDefault && !nextActive) return { ...plan, refusal: current.isDefault ? 'deactivate' : 'promote_inactive' }
  if (nextDefault && !current.isDefault) {
    plan.fields.push('isDefault')
    plan.promotes = true
  }
  if (nextActive !== current.isActive) {
    plan.fields.push('isActive')
    plan.isActive = nextActive
  }
  return plan
}
