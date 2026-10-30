// Normalisation and format rules of user identity fields (MOD-03-T02). Pure
// functions plus one class-validator decorator; unit-tested in
// users.validation.spec.ts. The database repeats the hard rules as CHECKs
// (lower-case e-mail/username, at least one login identifier — D13).
import { registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';

/** Longest e-mail address accepted (RFC 5321 path limit, as in LoginDto). */
export const EMAIL_MAX_LENGTH = 320;
/** Usernames: 3–64 characters, lower-case letters, digits, `.`, `_`, `-`, starting with a letter or digit. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
/** E.164: `+` then 7–15 digits, no leading zero. */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
/** Student and employee numbers: free text the academy chooses, 1–32 visible characters. */
export const REFERENCE_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/;

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `%`, `_` and `\` matched literally inside a LIKE/ILIKE pattern (PostgreSQL
 * escape character `\`). Prisma does not escape `contains`/`startsWith` values
 * (KI-034); shared by the users search and the audit-log `action` prefix (T10).
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** `trim` + lower-case; empty results become undefined so "" counts as absent. */
export function normalizeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return value === null ? undefined : (value as undefined);
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 ? undefined : normalized;
}

/** `trim`; empty results become undefined. Non-strings are returned untouched for the validator to reject. */
export function normalizeText(value: unknown): unknown {
  if (typeof value !== 'string') return value === null ? undefined : value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Normaliser for class-transformer's @Transform: identifiers (e-mail, username). */
export function identifierParam({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? normalizeIdentifier(value) : normalizeText(value);
}

/** Normaliser for class-transformer's @Transform: free text. */
export function textParam({ value }: { value: unknown }): unknown {
  return normalizeText(value);
}

// PATCH semantics (MOD-03-T04): an absent field is left alone, `null` clears
// an optional field, a value replaces it. These transforms keep `null` (the
// creation transforms above turn it into "absent").

/** @Transform for optional text in a PATCH: `null` or a blank string clears the field; other strings are trimmed. */
export function nullableTextParam({ value }: { value: unknown }): unknown {
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** @Transform for optional identifiers (e-mail, username) in a PATCH: like nullableTextParam, lower-cased. */
export function nullableIdentifierParam({ value }: { value: unknown }): unknown {
  const text = nullableTextParam({ value });
  return typeof text === 'string' ? text.toLowerCase() : text;
}

/** @Transform for required text in a PATCH: trims, but keeps a blank string so the length rule rejects it. */
export function trimParam({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * True for a real calendar day written as `YYYY-MM-DD` (so `2026-02-30` is
 * rejected). Dates are stored in `date` columns and compared as UTC midnight.
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !CALENDAR_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** `YYYY-MM-DD` → the Date stored in a `@db.Date` column (UTC midnight). */
export function calendarDateToDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** class-validator decorator: the property must be a valid `YYYY-MM-DD` calendar date. */
export function IsCalendarDate(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: `${String(propertyName)} must be a calendar date in the form YYYY-MM-DD`,
        ...options,
      },
      validator: { validate: (value: unknown) => isCalendarDate(value) },
    });
  };
}
