// Planning of a PATCH /api/academy (MOD-02/MOD-14, D-R10) as a pure function
// on the pattern of users.changes.ts, so the rules are unit-tested without a
// database (academy.changes.spec.ts). The request is compared with the current
// row: only fields whose value actually changes are written, an idempotent
// PATCH writes nothing and records no audit event, and the audit metadata
// carries the names of the changed fields — never their values. Since
// MOD-02-T03 the settings keys are planned the same way, key by key, after the
// row fields (dotted names such as `settings.scheduling.weekStartsOn`).
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocaleCode, LocalizedText } from '../authorization/localized-text.js';
import { applySettingsChanges, hasStoredKey, readSettings, sameSettingValue, settingsPatchEntries, SETTINGS_FIELDS } from './academy.settings.js';
import type { SettingsField, SettingsPatch, SettingValue } from './academy.settings.js';

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
  settings?: SettingsPatch;
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
  /** The stored `settings` jsonb as it is (unknown keys included). */
  settings: unknown;
}

/** Column values to write; `name` is the complete localized object, `settings` the complete new jsonb. */
export type AcademyUpdateData = Partial<Omit<CurrentAcademyRow, 'settings'>> & { settings?: Record<string, unknown> };

export interface AcademyUpdatePlan {
  data: AcademyUpdateData;
  /** Names of the fields that change: row fields in ACADEMY_PATCH_FIELDS order, then settings keys in SETTINGS_FIELDS order; empty = nothing to write. */
  fields: Array<AcademyPatchField | SettingsField>;
}

/**
 * True when the body carries no field at all (`{}`, and also `{ settings: {} }`
 * or `{ settings: { scheduling: {} } }`); accepts the DTO before its name is reduced.
 */
export function isEmptyAcademyPatch(patch: Partial<Record<AcademyPatchField, unknown>> & { settings?: unknown }): boolean {
  return ACADEMY_PATCH_FIELDS.every((field) => patch[field] === undefined) && !hasSettingsKey(patch.settings);
}

/** Any known settings key present (`null` counts — it clears the key). */
function hasSettingsKey(settings: unknown): boolean {
  if (settings === undefined || settings === null || typeof settings !== 'object') return false;
  return SETTINGS_FIELDS.some(({ domain, key }) => {
    const section = (settings as Record<string, unknown>)[domain];
    return section !== null && typeof section === 'object' && (section as Record<string, unknown>)[key] !== undefined;
  });
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
  const fields: Array<AcademyPatchField | SettingsField> = [];
  for (const field of ACADEMY_PATCH_FIELDS) {
    const requested = patch[field];
    if (requested === undefined) continue;
    const unchanged =
      field === 'name' ? sameLocalizedText(current.name, requested as LocalizedText) : current[field] === requested;
    if (unchanged) continue;
    (data as Record<string, unknown>)[field] = requested;
    fields.push(field);
  }

  // Settings, key by key: compared with the lenient reading of the stored value;
  // `null` on a key that is stored but unreadable still clears it.
  const known = readSettings(current.settings);
  const changes: Array<[SettingsField, SettingValue | null]> = [];
  for (const [field, requested] of settingsPatchEntries(patch.settings)) {
    const { domain, key } = SETTINGS_FIELDS.find((entry) => entry.field === field)!;
    const now = (known as unknown as Record<string, Record<string, SettingValue | null>>)[domain]![key] ?? null;
    const unchanged = requested === null ? now === null && !hasStoredKey(current.settings, field) : sameSettingValue(now, requested);
    if (unchanged) continue;
    changes.push([field, requested]);
    fields.push(field);
  }
  if (changes.length > 0) data.settings = applySettingsChanges(current.settings, changes);
  return { data, fields };
}
