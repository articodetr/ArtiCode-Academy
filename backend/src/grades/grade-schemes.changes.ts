// Grade scheme rules of MOD-09-T02 (roadmap §4h.4 API-122..API-125; owner
// decision D-R46) as pure functions, unit-tested in grade-schemes.changes.spec.ts:
//
//   bands     a band covers the percentages from its minimum up to the next
//             band's; a scheme needs a band at 0, distinct minimums, at least
//             one passing band, and every band above a passing one passes
//   band of   the highest minimum that does not exceed the percentage
//   update    the smallest change: name, the whole band list (compared in
//             canonical order), isDefault (promotion only), isActive
import type { LocalizedText } from '../authorization/localized-text.js';
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { DefaultSchemeAction, GradeSchemeProblem } from './grades.errors.js';

export interface SchemeBand {
  /** Two decimals as text (numeric(5,2)), e.g. "60.00". */
  minPercent: string;
  label: LocalizedText;
  letter: string | null;
  isPass: boolean;
}

/** numeric(5,2) text of a percentage. */
export function percentText(value: number | string): string {
  return Number(value).toFixed(2);
}

/** Bands in ascending order of their minimum. */
export function sortBands<T extends { minPercent: string }>(bands: readonly T[]): T[] {
  return [...bands].sort((a, b) => Number(a.minPercent) - Number(b.minPercent));
}

export interface BandCheck {
  problems: GradeSchemeProblem[];
  /** Minimums that appear more than once. */
  duplicates: number[];
}

/** The rules a band list breaks; empty problems = valid. */
export function checkBands(bands: readonly SchemeBand[]): BandCheck {
  const problems: GradeSchemeProblem[] = [];
  const counts = new Map<string, number>();
  for (const band of bands) counts.set(band.minPercent, (counts.get(band.minPercent) ?? 0) + 1);
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([min]) => Number(min)).sort((a, b) => a - b);
  if (!counts.has(percentText(0))) problems.push('no_zero_band');
  if (duplicates.length > 0) problems.push('duplicate_min_percent');
  if (!bands.some((band) => band.isPass)) problems.push('no_passing_band');
  const sorted = sortBands(bands);
  const firstPass = sorted.findIndex((band) => band.isPass);
  if (firstPass >= 0 && sorted.slice(firstPass).some((band) => !band.isPass)) problems.push('pass_not_ascending');
  return { problems, duplicates };
}

/** The band a percentage falls in: the highest minimum that does not exceed it (bands assumed valid). */
export function bandOf<T extends { minPercent: string }>(bands: readonly T[], percent: number): T | null {
  let found: T | null = null;
  for (const band of sortBands(bands)) {
    if (Number(band.minPercent) <= percent) found = band;
  }
  return found;
}

function sameBand(a: SchemeBand, b: SchemeBand): boolean {
  return a.minPercent === b.minPercent && sameLocalizedText(a.label, b.label) && a.letter === b.letter && a.isPass === b.isPass;
}

/** Same bands in canonical (ascending) order. */
export function sameBands(a: readonly SchemeBand[], b: readonly SchemeBand[]): boolean {
  if (a.length !== b.length) return false;
  const left = sortBands(a);
  const right = sortBands(b);
  return left.every((band, index) => sameBand(band, right[index]!));
}

export interface CurrentScheme {
  name: LocalizedText;
  isDefault: boolean;
  isActive: boolean;
  bands: SchemeBand[];
}

export interface SchemePatch {
  name?: LocalizedText;
  bands?: SchemeBand[];
  isDefault?: boolean;
  isActive?: boolean;
}

export interface SchemeUpdatePlan {
  /** The changed fields in a stable order. */
  fields: ('name' | 'bands' | 'isDefault' | 'isActive')[];
  name?: LocalizedText;
  bands?: SchemeBand[];
  isActive?: boolean;
  /** True when this scheme becomes the default (the previous default steps down). */
  promotes: boolean;
  /** Set when the change breaks the "one active default" rule. */
  refusal?: DefaultSchemeAction;
}

/**
 * The smallest update of a scheme. `isDefault: false` on the default is a
 * refusal (another scheme must be promoted); on any other scheme it changes
 * nothing. The default stays active, and an inactive scheme is promoted only
 * together with its activation.
 */
export function planGradeSchemeUpdate(current: CurrentScheme, patch: SchemePatch): SchemeUpdatePlan {
  const plan: SchemeUpdatePlan = { fields: [], promotes: false };
  if (patch.name !== undefined && !sameLocalizedText(patch.name, current.name)) {
    plan.fields.push('name');
    plan.name = patch.name;
  }
  if (patch.bands !== undefined && !sameBands(patch.bands, current.bands)) {
    plan.fields.push('bands');
    plan.bands = sortBands(patch.bands);
  }
  const nextActive = patch.isActive ?? current.isActive;
  if (patch.isDefault === false && current.isDefault) return { ...plan, refusal: 'unset_default' };
  const nextDefault = patch.isDefault === true ? true : current.isDefault;
  if (nextDefault && !nextActive) return { ...plan, refusal: current.isDefault ? 'deactivate' : 'promote_inactive' };
  if (nextDefault && !current.isDefault) {
    plan.fields.push('isDefault');
    plan.promotes = true;
  }
  if (nextActive !== current.isActive) {
    plan.fields.push('isActive');
    plan.isActive = nextActive;
  }
  return plan;
}
