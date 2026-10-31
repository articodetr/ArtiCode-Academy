// Academy identity and settings (MOD-02/MOD-14 minimum — ADR-044):
// API-035 GET /api/academy (every signed-in user) and API-036 PATCH /api/academy
// (`academy.settings.manage`). Types mirror backend/src/academy/academy.dto.ts;
// every call goes through apiRequest (Bearer header, refresh-and-retry on 401).
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

export type { LocalizedLabel } from './users'

export const ACADEMY_LOCALES = ['ar', 'en', 'tr'] as const
export type AcademyLocale = (typeof ACADEMY_LOCALES)[number]

/** `AcademyDto`: the single row without `settings`, `platformAcademyId` or `singleton`. */
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
  createdAt: string
  updatedAt: string
}

/**
 * Body of API-036 (`UpdateAcademyDto`): absent = unchanged; `null` clears
 * `logoUrl`/`contactEmail`/`contactPhone`; `name` replaces the whole localized
 * object (`ar` required); `defaultLocale`/`timezone`/`currency` never null.
 */
export interface UpdateAcademyInput {
  name?: LocalizedLabel
  logoUrl?: string | null
  defaultLocale?: AcademyLocale
  timezone?: string
  currency?: string
  contactEmail?: string | null
  contactPhone?: string | null
}

export const ACADEMY_PATH = '/api/academy'

export function getAcademy(signal?: AbortSignal): Promise<Academy> {
  return apiRequest<Academy>(ACADEMY_PATH, { signal })
}

export function updateAcademy(input: UpdateAcademyInput): Promise<Academy> {
  return apiRequest<Academy>(ACADEMY_PATH, { method: 'PATCH', body: input })
}
