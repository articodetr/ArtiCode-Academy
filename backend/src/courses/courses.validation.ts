// Code rules of MOD-04 (levels and courses). Codes are trimmed and upper-cased
// before validation so "py-101" and "PY-101" are the same code; the database
// repeats the trimming rule as a CHECK (ck_levels_code_trimmed,
// ck_courses_code_trimmed) and the uniqueness as `levels_code_key` /
// `courses_code_key`.

/** Level codes: 1–16 characters, upper-case letters, digits, `.`, `_`, `-`, starting with a letter or digit. */
export const LEVEL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,15}$/;
/** Course codes: 1–32 characters with the same alphabet. */
export const COURSE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;

/** `trim` + upper-case; blank becomes undefined (absent). Non-strings are returned for the validator to reject. */
export function normalizeCode(value: unknown): unknown {
  if (typeof value !== 'string') return value === null ? undefined : value;
  const normalized = value.trim().toUpperCase();
  return normalized.length === 0 ? undefined : normalized;
}

/** Normaliser for class-transformer's @Transform on code fields. */
export function codeParam({ value }: { value: unknown }): unknown {
  return normalizeCode(value);
}

/**
 * Body booleans must be JSON booleans: reads the raw value so the implicit
 * conversion of the ValidationPipe cannot turn `"yes"` or `1` into `true`
 * (same rule as guardians.dto.ts); @IsBoolean then rejects anything else.
 */
export function rawBoolean({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}
