// Pure planning of level writes (MOD-04-T02), unit-tested in
// levels.changes.spec.ts without a database: a PATCH writes only the fields
// whose value changes (nothing at all when nothing differs), and a reorder must
// be an exact permutation of every level.
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { LevelOrderProblems } from '../courses/courses.errors.js';

/** Fields a PATCH may set, in the fixed order of `fields`. */
export const LEVEL_PATCH_FIELDS = ['code', 'name', 'description', 'isActive'] as const;
export type LevelPatchField = (typeof LEVEL_PATCH_FIELDS)[number];

export interface LevelPatch {
  code?: string;
  name?: LocalizedText;
  description?: LocalizedText | null;
  isActive?: boolean;
}

export interface CurrentLevel {
  code: string;
  name: LocalizedText;
  description: LocalizedText | null;
  isActive: boolean;
}

export interface LevelUpdatePlan {
  data: LevelPatch;
  /** Changed field names in LEVEL_PATCH_FIELDS order; empty = nothing to write. */
  fields: LevelPatchField[];
}

/** True when the body carries no field at all (`{}`). */
export function isEmptyLevelPatch(patch: Partial<Record<LevelPatchField, unknown>>): boolean {
  return LEVEL_PATCH_FIELDS.every((field) => patch[field] === undefined);
}

export function planLevelUpdate(current: CurrentLevel, patch: LevelPatch): LevelUpdatePlan {
  const data: LevelPatch = {};
  const fields: LevelPatchField[] = [];
  if (patch.code !== undefined && patch.code !== current.code) {
    data.code = patch.code;
    fields.push('code');
  }
  if (patch.name !== undefined && !sameLocalizedText(current.name, patch.name)) {
    data.name = patch.name;
    fields.push('name');
  }
  if (patch.description !== undefined && !sameLocalizedText(current.description, patch.description)) {
    data.description = patch.description;
    fields.push('description');
  }
  if (patch.isActive !== undefined && patch.isActive !== current.isActive) {
    data.isActive = patch.isActive;
    fields.push('isActive');
  }
  return { data, fields };
}

export type LevelOrderCheck =
  | { ok: true; changed: boolean }
  | { ok: false; problems: LevelOrderProblems };

/**
 * `currentIds` in the current order, `requested` the new order. The request
 * must list every existing id exactly once; `changed` is false when the order
 * is already the requested one (nothing to write, no event).
 */
export function checkLevelOrder(currentIds: readonly string[], requested: readonly string[]): LevelOrderCheck {
  const existing = new Set(currentIds);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const unknown: string[] = [];
  for (const id of requested) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
    if (!existing.has(id)) unknown.push(id);
  }
  const missing = currentIds.filter((id) => !seen.has(id));
  if (missing.length > 0 || unknown.length > 0 || duplicates.size > 0) {
    return { ok: false, problems: { missing, unknown: [...new Set(unknown)], duplicates: [...duplicates] } };
  }
  const changed = requested.some((id, index) => currentIds[index] !== id);
  return { ok: true, changed };
}
