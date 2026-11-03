// Pure planning of a class PATCH (MOD-05-T02), on the pattern of
// courses.changes.ts: only fields whose value changes are written, an
// idempotent PATCH writes nothing and records nothing, and the audit metadata
// carries field names only. The course and the status are not patchable here
// (a class belongs to one course; the status changes through
// POST /api/classes/:id/status).
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';

export const CLASS_PATCH_FIELDS = ['code', 'name', 'capacity', 'startsOn', 'endsOn', 'notes'] as const;
export type ClassPatchField = (typeof CLASS_PATCH_FIELDS)[number];

export interface ClassValues {
  code: string;
  name: LocalizedText;
  capacity: number;
  /** `YYYY-MM-DD` (date column), so equality and ordering are plain string comparisons. */
  startsOn: string | null;
  endsOn: string | null;
  notes: string | null;
}

export type ClassPatch = Partial<ClassValues>;

export interface ClassUpdatePlan {
  data: ClassPatch;
  fields: ClassPatchField[];
}

/** True when the body carries no field at all (`{}`). */
export function isEmptyClassPatch(patch: Partial<Record<ClassPatchField, unknown>>): boolean {
  return CLASS_PATCH_FIELDS.every((field) => patch[field] === undefined);
}

export function planClassUpdate(current: ClassValues, patch: ClassPatch): ClassUpdatePlan {
  const data: ClassPatch = {};
  const fields: ClassPatchField[] = [];
  for (const field of CLASS_PATCH_FIELDS) {
    const requested = patch[field];
    if (requested === undefined) continue;
    const unchanged =
      field === 'name' ? sameLocalizedText(current.name, requested as LocalizedText) : current[field] === requested;
    if (unchanged) continue;
    (data as Record<string, unknown>)[field] = requested;
    fields.push(field);
  }
  return { data, fields };
}

/** The date range after applying the patch; null when it is consistent (or open-ended). */
export function invalidDateRange(
  current: Pick<ClassValues, 'startsOn' | 'endsOn'>,
  patch: ClassPatch,
): { startsOn: string; endsOn: string } | null {
  const startsOn = patch.startsOn !== undefined ? patch.startsOn : current.startsOn;
  const endsOn = patch.endsOn !== undefined ? patch.endsOn : current.endsOn;
  if (startsOn !== null && endsOn !== null && endsOn < startsOn) return { startsOn, endsOn };
  return null;
}
