// Academy identity and settings (MOD-02/MOD-14 minimum — ADR-044):
// API-035 GET /api/academy (every signed-in user) and API-036 PATCH /api/academy
// (`academy.settings.manage`). Types mirror backend/src/academy/academy.dto.ts;
// every call goes through apiRequest (Bearer header, refresh-and-retry on 401).
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

export type { LocalizedLabel } from './users'

export const ACADEMY_LOCALES = ['ar', 'en', 'tr'] as const
export type AcademyLocale = (typeof ACADEMY_LOCALES)[number]

/** Day of the week as the server counts it: 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** `SchedulingSettingsDto` (MOD-02-T03): `null` = not set — no country-bound default. */
export interface SchedulingSettings {
  /** First day of the week in calendars and timetables. */
  weekStartsOn: Weekday | null
  /** 1–7 distinct weekdays in ascending order. */
  workingDays: Weekday[] | null
}

/** `CertificatesSettingsDto` (MOD-10-T02, D-R51 — J-F51). */
export interface CertificatesSettings {
  /** Prefix of the certificate serials `PREFIX-YYYY-NNNNN`: 2–10 upper-case letters or digits; `null` = the default `CERT`. */
  serialPrefix: string | null
}

/** `AcademySettingsDto`: every known key, `null` when not set (an unreadable stored value reads as `null`). */
export interface AcademySettings {
  scheduling: SchedulingSettings
  /** Since MOD-10-T02 (CH-0176); a server before it sends no `certificates` — read it through `serialPrefixOf()`. */
  certificates: CertificatesSettings
}

/** `settings` of a PATCH, per key: absent = unchanged, `null` = clear, a value = replace. */
export interface AcademySettingsInput {
  scheduling?: {
    weekStartsOn?: Weekday | null
    workingDays?: Weekday[] | null
  }
  certificates?: {
    serialPrefix?: string | null
  }
}

/** `AcademyDto`: the single row without `platformAcademyId` or `singleton`; `settings` since MOD-02-T03. */
export interface Academy {
  id: string
  /** Deployment identifier; read-only. */
  slug: string
  name: LocalizedLabel
  logoUrl: string | null
  defaultLocale: AcademyLocale
  /** IANA time zone name (or `UTC`). */
  timezone: string
  /** ISO 4217 code, upper-case. */
  currency: string
  contactEmail: string | null
  contactPhone: string | null
  settings: AcademySettings
  createdAt: string
  updatedAt: string
}

/**
 * Body of API-036 (`UpdateAcademyDto`): absent = unchanged; `null` clears
 * `logoUrl`/`contactEmail`/`contactPhone`; `name` replaces the whole localized
 * object (`ar` required); `defaultLocale`/`timezone`/`currency` never null;
 * `settings` is patched key by key and is never null itself.
 */
export interface UpdateAcademyInput {
  name?: LocalizedLabel
  logoUrl?: string | null
  defaultLocale?: AcademyLocale
  timezone?: string
  currency?: string
  contactEmail?: string | null
  contactPhone?: string | null
  settings?: AcademySettingsInput
}

export const ACADEMY_PATH = '/api/academy'

export function getAcademy(signal?: AbortSignal): Promise<Academy> {
  return apiRequest<Academy>(ACADEMY_PATH, { signal })
}

export function updateAcademy(input: UpdateAcademyInput): Promise<Academy> {
  return apiRequest<Academy>(ACADEMY_PATH, { method: 'PATCH', body: input })
}
