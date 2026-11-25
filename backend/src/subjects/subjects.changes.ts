// Pure planning of subject writes (PORTAL-04, a mirror of levels.changes.ts),
// unit-tested in subjects.changes.spec.ts without a database: a PATCH writes
// only the fields whose value changes (nothing at all when nothing differs),
// and a reorder must be an exact permutation of every subject.
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { SubjectOrderProblems } from '../courses/courses.errors.js';

/** Fields a PATCH may set, in the fixed order of `fields`. */
export const SUBJECT_PATCH_FIELDS = ['code', 'name', 'isActive'] as const;
export type SubjectPatchField = (typeof SUBJECT_PATCH_FIELDS)[number];

export interface SubjectPatch {
  code?: string;
  name?: LocalizedText;
  isActive?: boolean;
}

export interface CurrentSubject {
  code: string;
  name: LocalizedText;
  isActive: boolean;
}

export interface SubjectUpdatePlan {
  data: SubjectPatch;
  /** Changed field names in SUBJECT_PATCH_FIELDS order; empty = nothing to write. */
  fields: SubjectPatchField[];
}

/** True when the body carries no field at all (`{}`). */
export function isEmptySubjectPatch(patch: Partial<Record<SubjectPatchField, unknown>>): boolean {
  return SUBJECT_PATCH_FIELDS.every((field) => patch[field] === undefined);
}

export function planSubjectUpdate(current: CurrentSubject, patch: SubjectPatch): SubjectUpdatePlan {
  const data: SubjectPatch = {};
  const fields: SubjectPatchField[] = [];
  if (patch.code !== undefined && patch.code !== current.code) {
    data.code = patch.code;
    fields.push('code');
  }
  if (patch.name !== undefined && !sameLocalizedText(current.name, patch.name)) {
    data.name = patch.name;
    fields.push('name');
  }
  if (patch.isActive !== undefined && patch.isActive !== current.isActive) {
    data.isActive = patch.isActive;
    fields.push('isActive');
  }
  return { data, fields };
}

export type SubjectOrderCheck =
  | { ok: true; changed: boolean }
  | { ok: false; problems: SubjectOrderProblems };

/**
 * `currentIds` in the current order, `requested` the new order. The request
 * must list every existing id exactly once; `changed` is false when the order
 * is already the requested one (nothing to write, no event).
 */
export function checkSubjectOrder(currentIds: readonly string[], requested: readonly string[]): SubjectOrderCheck {
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
