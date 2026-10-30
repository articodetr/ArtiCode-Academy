// Client-side mirrors of the backend input rules (backend/src/users/users.validation.ts
// and users.dto.ts). They give immediate feedback; the server stays the authority.

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/
export const REFERENCE_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/
export const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{2,63}$/
export const HTTP_URL_PATTERN = /^https?:\/\/\S+$/i
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export const EMAIL_MAX_LENGTH = 320
export const ROLE_KEYS_MAX = 10

/** `YYYY-MM-DD` naming a real calendar day (2026-02-30 is rejected). */
export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Username as the server normalises it (trim + lower-case) against its pattern. */
export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value.trim().toLowerCase())
}

export function isValidRoleKey(value: string): boolean {
  return ROLE_KEY_PATTERN.test(value.trim().toLowerCase())
}
