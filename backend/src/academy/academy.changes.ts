// Planning of a PATCH /api/academy (MOD-02/MOD-14, D-R10) as a pure function
// on the pattern of users.changes.ts, so the rules are unit-tested without a
// database (academy.changes.spec.ts). The request is compared with the current
// row: only fields whose value actually changes are written, an idempotent
// PATCH writes nothing and records no audit event, and the audit metadata
// carries the names of the changed fields — never their values.
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocaleCode, LocalizedText } from '../authorization/localized-text.js';

/** Fields of `academy` a PATCH may set, in the fixed order of `fields`. */
export const ACADEMY_PATCH_FIELDS = ['name', 'logoUrl', 'defaultLocale', 'timezone', 'currency', 'contactEmail', 'contactPhone'] as const;

export type AcademyPatchField = (typeof ACADEMY_PATCH_FIELDS)[number];

/** Validated request (name already reduced to `{ ar, en?, tr? }` strings). */
export interface AcademyPatch {
  name?: LocalizedText;
  logoUrl?: string | null;
  defaultLocale?: LocaleCode;
  timezone?: string;
  currency?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

/** What the planner needs to know about the row as it is now. */
export interface CurrentAcademyRow {
  name: LocalizedText;
  logoUrl: string | null;
  defaultLocale: LocaleCode;
  timezone: string;
  currency: string;
  contactEmail: string | null;
  contactPhone: string | null;
}

/** Column values to write; `name` is the complete localized object. */
export type AcademyUpdateData = Partial<CurrentAcademyRow>;

export interface AcademyUpdatePlan {
  data: AcademyUpdateData;
  /** Names of the fields that change, in the order of ACADEMY_PATCH_FIELDS; empty = nothing to write. */
  fields: AcademyPatchField[];
}

/** True when the body carries no field at all (`{}`); accepts the DTO before its name is reduced. */
export function isEmptyAcademyPatch(patch: Partial<Record<AcademyPatchField, unknown>>): boolean {
  return ACADEMY_PATCH_FIELDS.every((field) => patch[field] === undefined);
}

/** Kept as a re-export: the comparison moved to authorization/localized-text.ts (third consumer — CH-0044). */
export { sameLocalizedText };

/**
 * Decides what a PATCH writes. Validation and normalisation (trim, lower-case
 * e-mail, upper-case currency, IANA zone, dropped blank locales) happened in
 * the DTO; this function only compares.
 */
export function planAcademyUpdate(current: CurrentAcademyRow, patch: AcademyPatch): AcademyUpdatePlan {
  const data: AcademyUpdateData = {};
  const fields: AcademyPatchField[] = [];
  for (const field of ACADEMY_PATCH_FIELDS) {
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
