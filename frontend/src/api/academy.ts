// Academy identity and settings (MOD-02/MOD-14 minimum — ADR-044):
// API-035 GET /api/academy (every signed-in user) and API-036 PATCH /api/academy
// (`academy.settings.manage`). Types mirror backend/src/academy/academy.dto.ts;
// every call goes through apiRequest (Bearer header, refresh-and-retry on 401).
// API-205 GET /api/academy/public (no sign-in, 60/min per IP) is read without a
// token and without a session refresh: the sign-in page and the public catalog.
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

/** `LearningSettingsDto` (MOD-20, D-R134): the self-paced learning of «My School». */
export interface LearningSettings {
  /** Share (integer 50–100) of an uploaded video's or audio's duration a learner must play to complete it; `null` = the default 90. */
  videoCompletionPercent: number | null
}

/** `CatalogSettingsDto` (MOD-20, D-R138). */
export interface CatalogSettings {
  /** `true` = visitors may browse the published courses without signing in (API-236/237); `null` = off. */
  publicBrowsing: boolean | null
}

/** `AcademySettingsDto`: every known key, `null` when not set (an unreadable stored value reads as `null`). */
export interface AcademySettings {
  scheduling: SchedulingSettings
  /** Since MOD-10-T02 (CH-0176); a server before it sends no `certificates` — read it through `serialPrefixOf()`. */
  certificates: CertificatesSettings
  /** Since MOD-20; a server before it sends no `learning` — read it through `videoCompletionPercentOf()`. */
  learning: LearningSettings
  /** Since MOD-20; a server before it sends no `catalog` — read it through `publicBrowsingOf()`. */
  catalog: CatalogSettings
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
  learning?: {
    videoCompletionPercent?: number | null
  }
  catalog?: {
    publicBrowsing?: boolean | null
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

/** The four places of the public home page (/home) whose picture the academy may replace (`settings.homepageImages.<key>`). */
export type HomepageImageKey = 'heroStudent' | 'aboutLearners' | 'promoTraining' | 'whyClassroom'

/**
 * API-205 `homepageImages`: the public address of the academy's own picture of each place — root-relative,
 * `/api/academy/media/<file>` — or `null` for the built-in default. Nothing else about the files is published.
 */
export type PublicHomepageImages = Record<HomepageImageKey, string | null>

/**
 * `AcademyPublicDto` (API-205): what the sign-in page and the public catalog show before anybody is signed in —
 * nothing else of the academy. `catalogPublic` since MOD-20 (D-R138); a server before it sends none (read as false).
 * `homepageImages` since the homepage images settings; a server before them sends none (every place keeps its default).
 */
export interface PublicAcademy {
  name: LocalizedLabel
  logoUrl: string | null
  defaultLocale: AcademyLocale
  /** `settings.catalog.publicBrowsing === true`: the public catalog (/explore) answers. */
  catalogPublic?: boolean
  homepageImages?: PublicHomepageImages | null
  /** PORTAL-03 (#221): the academy lets a visitor create a student account and a mail transport is set. Absent = closed. */
  selfRegistration?: boolean
  /** PORTAL-04: Google sign-in is configured on this server (`POST /api/auth/google/start` answers). Absent = off. */
  googleSignIn?: boolean
  /** PORTAL-04: `googleSignIn` and the academy takes registrations, so a new Google account becomes a student. Absent = off. */
  googleSignUp?: boolean
}

export const ACADEMY_PATH = '/api/academy'
export const ACADEMY_PUBLIC_PATH = '/api/academy/public'

export function getAcademy(signal?: AbortSignal): Promise<Academy> {
  return apiRequest<Academy>(ACADEMY_PATH, { signal })
}

export function updateAcademy(input: UpdateAcademyInput): Promise<Academy> {
  return apiRequest<Academy>(ACADEMY_PATH, { method: 'PATCH', body: input })
}

/** API-205: no access token and no session refresh — a visitor has neither. */
export function getPublicAcademy(signal?: AbortSignal): Promise<PublicAcademy> {
  return apiRequest<PublicAcademy>(ACADEMY_PUBLIC_PATH, { signal, auth: false, retry: false })
}

/** True only when the academy says its catalog is open to visitors (absent on a server before MOD-20 = false). */
export function isCatalogPublic(academy: Pick<PublicAcademy, 'catalogPublic'> | null | undefined): boolean {
  return academy?.catalogPublic === true
}

/** True only when the server says so: a server before PORTAL-03, a failed read or a missing field all read as closed. */
export function isSelfRegistrationOpen(academy: Pick<PublicAcademy, 'selfRegistration'> | null | undefined): boolean {
  return academy?.selfRegistration === true
}

/** True only when the server says Google sign-in is configured: an older server, a failed read or a missing field read as off. */
export function isGoogleSignInOn(academy: Pick<PublicAcademy, 'googleSignIn'> | null | undefined): boolean {
  return academy?.googleSignIn === true
}

/** True only when the server says a new account may be created through Google (`googleSignUp`). */
export function isGoogleSignUpOpen(academy: Pick<PublicAcademy, 'googleSignUp'> | null | undefined): boolean {
  return academy?.googleSignUp === true
}

/**
 * A visitor may create an account: by e-mail (`selfRegistration`) only. PORTAL-04-GOOGLE-OFF (provisional id — the owner's
 * request): the site offers no Google button any more, so `googleSignUp` alone opens no "إنشاء حساب" link.
 */
export function canCreateAccount(academy: Pick<PublicAcademy, 'selfRegistration'> | null | undefined): boolean {
  return isSelfRegistrationOpen(academy)
}
