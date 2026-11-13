// Input rules of the academies registry (MOD-18-T04) — pure functions plus the
// class-validator decorators and class-transformer helpers the DTOs use;
// unit-tested in registry.validation.spec.ts. The database repeats the hard
// rules as CHECKs (migration 20261113182048_platform_init); these mirror them so
// a bad value is a 400 and never a failed insert (a 500).
import { registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';
import type { PlanLimitsProblem } from './registry.errors.js';
import { PLAN_LIMITS_PROBLEMS } from './registry.errors.js';

/** CHECK `ck_academies_slug_format` — the slug rule of deploy/scripts/new-academy-env.mjs (compose project `academy-<slug>`). */
export const ACADEMY_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
/** CHECK `ck_academies_origin_format`: https on any host, http on loopback only; no path. */
export const ACADEMY_ORIGIN_PATTERN = /^(?:https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?|http:\/\/(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?)$/;
/** CHECK `ck_plans_key_format`. */
export const PLAN_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** Keys of a plan's `limits` object (camelCase, e.g. `students`, `storageGb`). */
export const PLAN_LIMIT_KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,39}$/;
export const PLAN_LIMITS_MAX_KEYS = 20;
/** One locale of a localized name (as the academy's LocalizedTextDto). */
export const LOCALIZED_NAME_MAX_LENGTH = 200;
/** CHECK `ck_academies_notes_length` (subscriptions notes share the bound). */
export const NOTES_MAX_LENGTH = 2000;
export const REASON_MAX_LENGTH = 500;
export const ORIGIN_MAX_LENGTH = 255;
export const HOSTNAME_MAX_LENGTH = 253;
/** RFC 5321 path limit, as the academy's EMAIL_MAX_LENGTH. */
export const EMAIL_MAX_LENGTH = 320;

/** PostgreSQL stores no NUL in a text; refused in validation so it is a 400 and not a failed insert (KI-078). */
export const NUL = '\u0000';

const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The academy's public origin in its stored form — `https://host[:port]`, or
 * `http://localhost[:port]` / `http://127.0.0.1[:port]` — or null when `value`
 * is none of these: host lower-cased (and IDN in punycode, by the WHATWG URL
 * parser), the default port dropped, no trailing slash; a path, a query, a
 * fragment or credentials make it invalid. Idempotent: a stored origin
 * normalizes to itself.
 */
export function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > ORIGIN_MAX_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (url.search !== '' || url.hash !== '') return null;
  // `https://host?` and `https://host#` parse with an empty query / fragment: refuse them too.
  if (/[?#]/.test(trimmed)) return null;
  const origin = `${url.protocol}//${url.host}`;
  return ACADEMY_ORIGIN_PATTERN.test(origin) ? origin : null;
}

/**
 * A hostname as `domains` stores it (CHECK `ck_domains_hostname_format`):
 * lower-case letters, digits and hyphens in dot-separated labels of 1–63
 * characters (no label starts or ends with `-`), at least two labels — or
 * `localhost`. At most 253 characters, no trailing dot.
 */
export function isHostname(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > HOSTNAME_MAX_LENGTH) return false;
  if (value === 'localhost') return true;
  const labels = value.split('.');
  return labels.length >= 2 && labels.every((label) => HOSTNAME_LABEL.test(label));
}

export interface PlanLimitsVerdict {
  /** Distinct problems in PLAN_LIMITS_PROBLEMS order; empty = valid. */
  problems: PlanLimitsProblem[];
  /** Offending keys (a bad name or a bad value), in the order of the object. */
  keys: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A plan's `limits`: a flat JSON object of at most 20 keys matching
 * PLAN_LIMIT_KEY_PATTERN, each a non-negative (safe) integer or null
 * (null = no limit). Nested objects, arrays, strings, booleans and decimals are refused.
 */
export function checkPlanLimits(value: unknown): PlanLimitsVerdict {
  if (!isPlainObject(value)) return { problems: ['not_an_object'], keys: [] };
  const found = new Set<PlanLimitsProblem>();
  const keys: string[] = [];
  const entries = Object.entries(value);
  if (entries.length > PLAN_LIMITS_MAX_KEYS) found.add('too_many_keys');
  for (const [key, limit] of entries) {
    let bad = false;
    if (!PLAN_LIMIT_KEY_PATTERN.test(key)) {
      found.add('key_format');
      bad = true;
    }
    if (!(limit === null || (typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 0))) {
      found.add('value_type');
      bad = true;
    }
    if (bad) keys.push(key);
  }
  return { problems: PLAN_LIMITS_PROBLEMS.filter((problem) => found.has(problem)), keys };
}

export type PlanLimits = Record<string, number | null>;

/** The limits with their keys sorted — the stored and compared form (key order carries no meaning). */
export function canonicalLimits(value: PlanLimits): PlanLimits {
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key] ?? null]));
}

export function sameLimits(a: PlanLimits, b: PlanLimits): boolean {
  return JSON.stringify(canonicalLimits(a)) === JSON.stringify(canonicalLimits(b));
}

/** Reads a stored `limits` jsonb (the CHECK makes it an object) keeping only integer or null values. */
export function readPlanLimits(value: unknown): PlanLimits {
  if (!isPlainObject(value)) return {};
  const limits: PlanLimits = {};
  for (const [key, limit] of Object.entries(value)) {
    if (limit === null || typeof limit === 'number') limits[key] = limit;
  }
  return canonicalLimits(limits);
}

// ---------------------------------------------------------------------------
// class-transformer helpers — every one reads the RAW JSON value (`obj[key]`):
// the global implicit conversion would turn `42` into "42" or "no" into true
// before an ordinary @Transform sees it (KI-039).
// ---------------------------------------------------------------------------

type TransformArgs = { obj: Record<string, unknown>; key: string };

/** The raw JSON value, untouched (numbers, booleans, objects, dates). */
export function rawValue({ obj, key }: TransformArgs): unknown {
  return obj[key];
}

/** Required text: trimmed; a non-string stays what it is for @IsString to refuse; blank fails the length rule. */
export function rawTrimmed({ obj, key }: TransformArgs): unknown {
  const value = obj[key];
  return typeof value === 'string' ? value.trim() : value;
}

/** Optional text in a body: trimmed, a blank text or null = null (PATCH clears; POST stores nothing). */
export function rawNullableText({ obj, key }: TransformArgs): unknown {
  const value = obj[key];
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Identifiers (slug, plan key, hostname): trimmed and lower-cased. */
export function rawIdentifier({ obj, key }: TransformArgs): unknown {
  const value = obj[key];
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/** Optional e-mail: trimmed and lower-cased; blank or null = null. */
export function rawNullableEmail(args: TransformArgs): unknown {
  const value = rawNullableText(args);
  return typeof value === 'string' ? value.toLowerCase() : value;
}

/** Optional origin: normalized when valid (normalizeOrigin), else left for @IsAcademyOrigin to refuse; blank or null = null. */
export function rawNullableOrigin(args: TransformArgs): unknown {
  const value = rawNullableText(args);
  return typeof value === 'string' ? (normalizeOrigin(value) ?? value) : value;
}

/** Query text: trimmed; blank = absent. */
export function queryText({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Query boolean from the raw string: `true`/`1` and `false`/`0`; blank = absent; anything else fails @IsBoolean. */
export function queryBoolean({ obj, key }: TransformArgs): unknown {
  const value = obj[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}

// ---------------------------------------------------------------------------
// class-validator decorators
// ---------------------------------------------------------------------------

function decorator(name: string, message: string, validate: (value: unknown) => boolean, options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name,
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message, ...options },
      validator: { validate },
    });
  };
}

/** A stored-form origin (the transform `rawNullableOrigin` normalized every valid input already). */
export function IsAcademyOrigin(options?: ValidationOptions): PropertyDecorator {
  return decorator(
    'isAcademyOrigin',
    'origin must be https://host[:port] (or http://localhost / http://127.0.0.1 with an optional port), without a path',
    (value) => typeof value === 'string' && normalizeOrigin(value) === value,
    options,
  );
}

export function IsPlatformHostname(options?: ValidationOptions): PropertyDecorator {
  return decorator(
    'isPlatformHostname',
    'hostname must be a lower-case DNS name with at least two labels (or localhost), at most 253 characters',
    isHostname,
    options,
  );
}

/**
 * `min`..`max` characters counted the way PostgreSQL's `char_length()` (the
 * CHECKs) counts them — code points — and no NUL character. class-validator's
 * @Length counts differently (it drops variation selectors), so a text it
 * lets through could fail the insert (the announcements DTO rule, CH-0205).
 */
export function HasCharacters(min: number, max: number, options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) =>
    decorator(
      'hasCharacters',
      `${String(propertyName)} must be ${min} to ${max} characters long, without a NUL character`,
      (value) => {
        if (typeof value !== 'string' || value.includes(NUL)) return false;
        const characters = [...value].length;
        return characters >= min && characters <= max;
      },
      options,
    )(target, propertyName);
}
