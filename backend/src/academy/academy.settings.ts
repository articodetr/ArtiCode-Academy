// Academy settings (MOD-02-T03 — D3, D-R20, roadmap §4b.9): the `academy.settings`
// jsonb column, validated by zod in the service layer. The schemas below are
// the single source of the known keys; a new key = a schema here + 6.2 + 10.2,
// in the PR of the module that consumes it.
//
// `null` means "not set" — no country-bound default (the principle of CH-0012
// for the time zone and the currency): the frontend applies the user's locale,
// scheduling does not restrict the days. Reading is lenient: a stored value
// that fails its schema reads as `null` instead of failing the request.
import { registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';
import { z } from 'zod';

/** Day of the week as in `class_schedules.weekday` (6.7): 0 = Sunday … 6 = Saturday. */
export const weekdaySchema = z.number().int().min(0).max(6);

/** First day of the week in calendars and timetables. */
export const weekStartsOnSchema = weekdaySchema;

/** Working days: 1–7 distinct weekdays, stored in ascending order. */
export const workingDaysSchema = z
  .array(weekdaySchema)
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, { message: 'workingDays must not repeat a day' })
  .transform((days) => [...days].sort((a, b) => a - b));

/**
 * MOD-10 (D-R51): the prefix of the certificate serials `PREFIX-YYYY-NNNNN` —
 * 2–10 upper-case letters or digits; `null` = the default `CERT`.
 */
export const serialPrefixSchema = z.string().regex(/^[A-Z0-9]{2,10}$/);

/** The prefix used when the academy has not set one. */
export const DEFAULT_CERTIFICATE_SERIAL_PREFIX = 'CERT';

/**
 * Every known key with its dotted name (used in the audit `fields`) and its
 * path in the stored object, in the fixed order of the audit metadata.
 */
export const SETTINGS_FIELDS = [
  { field: 'settings.scheduling.weekStartsOn', domain: 'scheduling', key: 'weekStartsOn', schema: weekStartsOnSchema },
  { field: 'settings.scheduling.workingDays', domain: 'scheduling', key: 'workingDays', schema: workingDaysSchema },
  { field: 'settings.certificates.serialPrefix', domain: 'certificates', key: 'serialPrefix', schema: serialPrefixSchema },
] as const;

export type SettingsField = (typeof SETTINGS_FIELDS)[number]['field'];
export type SettingValue = number | number[] | string;

export interface SchedulingSettings {
  weekStartsOn: number | null;
  workingDays: number[] | null;
}

export interface CertificatesSettings {
  serialPrefix: string | null;
}

/** The settings as the API returns them: every known key, `null` when not set. */
export interface AcademySettings {
  scheduling: SchedulingSettings;
  certificates: CertificatesSettings;
}

/** A validated PATCH of the settings: absent = unchanged, `null` = clear, a value = replace. */
export interface SettingsPatch {
  scheduling?: {
    weekStartsOn?: number | null;
    workingDays?: number[] | null;
  };
  certificates?: {
    serialPrefix?: string | null;
  };
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

/** The stored jsonb → every known key (lenient: anything that fails its schema reads as null). */
export function readSettings(stored: unknown): AcademySettings {
  const root = asObject(stored);
  const out: Record<string, Record<string, unknown>> = { scheduling: {}, certificates: {} };
  for (const { domain, key, schema } of SETTINGS_FIELDS) {
    const parsed = schema.safeParse(asObject(root[domain])[key]);
    (out[domain] ??= {})[key] = parsed.success ? parsed.data : null;
  }
  return out as unknown as AcademySettings;
}

/** True when the stored object carries the key at all, valid or not (so `null` can clear a corrupt value). */
export function hasStoredKey(stored: unknown, field: SettingsField): boolean {
  const { domain, key } = SETTINGS_FIELDS.find((entry) => entry.field === field)!;
  return Object.hasOwn(asObject(asObject(stored)[domain]), key);
}

/** The requested changes, flattened to dotted fields in SETTINGS_FIELDS order; normalised (sorted days). */
export function settingsPatchEntries(patch: SettingsPatch | undefined): Array<[SettingsField, SettingValue | null]> {
  if (!patch) return [];
  const entries: Array<[SettingsField, SettingValue | null]> = [];
  for (const { field, domain, key, schema } of SETTINGS_FIELDS) {
    const requested = (asObject(patch[domain as keyof SettingsPatch]) as Record<string, unknown>)[key];
    if (requested === undefined) continue;
    entries.push([field, requested === null ? null : (schema.parse(requested) as SettingValue)]);
  }
  return entries;
}

/** Same value? Days are compared after sorting (both sides are normalised). */
export function sameSettingValue(a: SettingValue | null, b: SettingValue | null): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((day, i) => day === b[i]);
  return a === b;
}

/**
 * Writes the changes into a copy of the stored object. Keys this version does
 * not know are kept as they are; `null` removes a key, and a domain left empty
 * is removed too, so an academy that never set anything stores `{}`.
 */
export function applySettingsChanges(stored: unknown, changes: Array<[SettingsField, SettingValue | null]>): JsonObject {
  const next: JsonObject = structuredClone(asObject(stored));
  for (const [field, value] of changes) {
    const { domain, key } = SETTINGS_FIELDS.find((entry) => entry.field === field)!;
    const section: JsonObject = { ...asObject(next[domain]) };
    if (value === null) delete section[key];
    else section[key] = value;
    if (Object.keys(section).length === 0) delete next[domain];
    else next[domain] = section;
  }
  return next;
}

/**
 * class-validator rule backed by a zod schema, so the HTTP 400 and the stored
 * shape follow the same definition. `null` and `undefined` are left to
 * ValidateIf/IsOptional on the property.
 */
export function MatchesSchema(schema: z.ZodType, message: string, options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'matchesSchema',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message, ...options },
      validator: {
        validate: (value: unknown) => schema.safeParse(value).success,
      },
    });
  };
}
