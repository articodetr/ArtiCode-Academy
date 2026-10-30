// Pure presentation helpers of the users screens (MOD-03-T11): role labels,
// localized text, dates. No React, no i18next instance — callers pass `t`.
import type { LocalizedLabel, UserStatus, UserSummary } from '../api/users'
import { uiRoleFor } from '../auth/roles'
import type { Language } from '../i18n/language'

/** Seeded system roles (backend/src/authorization/system-roles.ts), in menu order. */
export const SYSTEM_ROLE_KEYS = ['academy_admin', 'staff', 'teacher', 'guardian', 'student'] as const

export type Translate = (key: string, options?: Record<string, unknown>) => string

/** Translated name of a system role; a custom role shows its key until T13 brings its labels. */
export function roleLabel(key: string, t: Translate): string {
  const ui = uiRoleFor(key)
  return ui ? t(`roles.${ui}`) : key
}

/** Picks the active language from `{ ar, en?, tr? }`, falling back to the mandatory Arabic. */
export function localizedLabel(label: LocalizedLabel, language: Language): string {
  return label[language] || label.ar
}

/** Tag colours for the account statuses of API-012 (`labels.*` carries the texts). */
export const USER_STATUS_COLORS: Readonly<Record<UserStatus, string>> = {
  invited: 'blue',
  pending: 'gold',
  active: 'green',
  suspended: 'red',
  archived: 'default',
}

const EMPTY = '—'

function intlLocale(language: Language): string {
  // Arabic with Latin digits keeps dates aligned with identifiers and numbers elsewhere on the page.
  return language === 'ar' ? 'ar-u-nu-latn' : 'en-GB'
}

/** ISO 8601 timestamp → localized date and time; a missing value shows a dash. */
export function formatDateTime(iso: string | null | undefined, language: Language): string {
  if (!iso) return EMPTY
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(intlLocale(language), { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** Calendar day `YYYY-MM-DD` → localized date, read as UTC so the day never shifts with the zone. */
export function formatDay(day: string | null | undefined, language: Language): string {
  if (!day) return EMPTY
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return new Intl.DateTimeFormat(intlLocale(language), { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}

/** What the UI calls the person: the display name when set, else the full name. */
export function displayNameOf(user: Pick<UserSummary, 'fullName' | 'displayName'>): string {
  return user.displayName?.trim() || user.fullName
}
