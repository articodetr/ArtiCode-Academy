// Pure rules of the public catalog (MOD-20, D-R138): the request of a page,
// how a card words whether a class is open, a level's name (D-R130), a lesson's
// length, what a failure says and where «سجّل في هذه الدورة» leads. Nothing
// here decides what the server decides. Unit-tested in publicCatalog.view.test.ts.
// PORTAL-04: a course is badged by its school subject (`subject`), never by its
// difficulty; a visitor reaches the sign-in (or the new-account) page with the
// enroll intent as its `returnTo`, and whether an account may be created is read
// from API-205 (`selfRegistration` or `googleSignUp`).
import { ApiError } from '../api/client'
import { levelOrdinalWord } from '../common/levelOrdinal'
import { isCatalogNotPublic } from '../api/publicCatalog'
import type { ListPublicCatalogParams, PublicCourseCard, PublicCourseList, PublicOutlineLevel } from '../api/publicCatalog'
import type { LocalizedLabel } from '../api/users'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'

export const PUBLIC_CATALOG_PAGE_SIZE = 24
/** Upper bound of `q` (1–100 characters after trim), as on API-219. */
export const PUBLIC_SEARCH_MAX_LENGTH = 100
/** How long the search box waits after the last keystroke before it asks the server. */
export const PUBLIC_SEARCH_DELAY_MS = 300
/** The parameters of one page of API-236. */
export function publicCatalogParams(q: string, cursor: string | undefined): ListPublicCatalogParams {
  const params: ListPublicCatalogParams = { limit: PUBLIC_CATALOG_PAGE_SIZE }
  const search = q.trim()
  if (search) params.q = search.slice(0, PUBLIC_SEARCH_MAX_LENGTH)
  if (cursor) params.cursor = cursor
  return params
}

/**
 * The search of the public catalog as an address carries it (`?q=` — PORTAL-04 PR-2): trimmed and cut to the server's
 * limit; '' without one. /explore reads its own address with it, and a course page reads the search it was opened from.
 */
export function exploreSearchOf(params: URLSearchParams): string {
  return (params.get('q') ?? '').trim().slice(0, PUBLIC_SEARCH_MAX_LENGTH)
}

/** The address of /explore for a search — /explore itself without one. Always this site's own path: the search is only
 * ever a value of `q`, never an address, so no link can lead elsewhere. */
export function explorePathFor(search: string): string {
  const q = search.trim().slice(0, PUBLIC_SEARCH_MAX_LENGTH)
  return q ? `/explore?${new URLSearchParams({ q }).toString()}` : '/explore'
}

/** A course page opened from a search keeps it in its own address (`/explore/:id?q=`), so «العودة إلى الدورات», a
 * refresh and a new tab all lead back to the same results. */
export function publicCoursePathFor(courseId: string, search: string): string {
  const path = `/explore/${encodeURIComponent(courseId)}`
  const q = search.trim().slice(0, PUBLIC_SEARCH_MAX_LENGTH)
  return q ? `${path}?${new URLSearchParams({ q }).toString()}` : path
}

/** The cards on screen after «المزيد»: the new page after the old one, a course already shown never twice. */
export function appendCards(current: readonly PublicCourseCard[], page: PublicCourseList['items']): PublicCourseCard[] {
  const shown = new Set(current.map((card) => card.id))
  return [...current, ...page.filter((card) => !shown.has(card.id))]
}

/** `priceUnavailable`: open classes, but none takes a request — the price tag already says why, so no tag is shown. */
export type PublicAvailability = 'available' | 'full' | 'closed' | 'priceUnavailable'

/**
 * Whether a class of the course takes a learner now — from the server's counts only. The server's `hasFreeSeat`
 * already folds the price in (`courseOfferOf()` in backend/src/catalog/catalog.service.ts: a class counts only with a
 * free seat AND, for a paid course, a usable plan), so a paid course without a price is never «full» (PORTAL-04 review);
 * the signed-in catalog's `cardAvailability()` reads its counts the same way.
 */
export function availabilityOf(card: Pick<PublicCourseCard, 'openClasses' | 'hasFreeSeat' | 'pricing' | 'price'>): PublicAvailability {
  if (card.openClasses === 0) return 'closed'
  if (card.hasFreeSeat) return 'available'
  return card.pricing === 'paid' && card.price === null ? 'priceUnavailable' : 'full'
}

/**
 * The i18n key of a card's availability pill. A course with no class open reads «قريبًا» on a card; its own page keeps
 * the plain explanation (`publicCatalog.card.closed`). `priceUnavailable` has no pill: the price already says why.
 */
export function availabilityPillKey(availability: Exclude<PublicAvailability, 'priceUnavailable'>): string {
  return availability === 'closed' ? 'publicCatalog.card.comingSoon' : `publicCatalog.card.${availability}`
}

// PORTAL-04-COURSE-ORDER: /explore no longer regroups a page by availability (`orderPublicPage()` is gone) — the cards
// keep the order the office sets with the arrows, which the server sends (API-236), and «قريبًا» stays on its card.

/** How many placeholder tints a card without a cover can take (publicCatalog.css `.public-card__placeholder--t0` … `--t4`). */
export const PLACEHOLDER_TINTS = 5

/** A stable tint for a course without a cover (PORTAL-04 PR-1 redesign): the same course always gets the same one. */
export function placeholderTintOf(id: string): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % PLACEHOLDER_TINTS
}

/**
 * Whether a visitor can go on to enroll in a public course now (PORTAL-04 PR-2), from the server's numbers only:
 * no class open to self-service → `not_open`; a paid course whose plan cannot price a request now →
 * `price_unavailable`; no open class with a free seat → `class_full`. The server refuses a class in the order
 * not_open → class_full → price_unavailable (`classBlocker()` of backend/src/catalog/catalog.policy.ts), but the
 * public course only says `hasFreeSeat`, which the server computes as «a free seat AND a usable price»
 * (`courseOfferOf()`), so an unusable price is checked before the seats here: either way nobody can enroll, and only
 * the price message is sure to be true. The learner-specific refusals (a pending request, already enrolled) are the
 * signed-in catalog's to say, after the sign-in.
 */
export type PublicEnrollState = 'enrollable' | 'not_open' | 'class_full' | 'price_unavailable'

export function publicEnrollStateOf(course: Pick<PublicCourseCard, 'openClasses' | 'hasFreeSeat' | 'pricing' | 'price'>): PublicEnrollState {
  if (course.openClasses === 0) return 'not_open'
  if (course.pricing === 'paid' && !course.price) return 'price_unavailable'
  if (!course.hasFreeSeat) return 'class_full'
  return 'enrollable'
}

type Translate = (key: string, options?: Record<string, unknown>) => string

/** «المستوى الأول» (+ « — title» when the level has one), Level 1 in English; past the tenth the number (D-R130). */
export function levelNameOf(level: Pick<PublicOutlineLevel, 'number' | 'title'>, t: Translate, language: Language): string {
  const ordinal = levelOrdinalWord(level.number, language)
  const title = level.title ? localizedLabel(level.title, language).trim() : ''
  return title ? t('publicCatalog.course.sectionTitled', { ordinal, title }) : t('publicCatalog.course.section', { ordinal })
}

export interface CourseBadge {
  key: 'type' | 'subject' | 'duration'
  text: string
}

/** A course's school subject as shown in `language`, or null without one (a server before PORTAL-04 sends none). */
export function subjectNameOf(course: { subject?: { name: LocalizedLabel } | null }, language: Language): string | null {
  const name = course.subject ? localizedLabel(course.subject.name, language).trim() : ''
  return name || null
}

/**
 * The small badges of a course, on its card and at the top of its page: that it is a course, its school subject
 * (`course.subject`, PORTAL-04 — no longer its difficulty, and never the curriculum's levels, `levelCount`/`outline`) and
 * its duration, each only when the server has it.
 */
export function courseBadgesOf(
  course: { subject?: { name: LocalizedLabel } | null; durationHours: number | null },
  t: Translate,
  language: Language,
): CourseBadge[] {
  const badges: CourseBadge[] = [{ key: 'type', text: t('publicCatalog.card.courseType') }]
  const subject = subjectNameOf(course, language)
  if (subject) badges.push({ key: 'subject', text: subject })
  if (course.durationHours !== null) badges.push({ key: 'duration', text: t('publicCatalog.card.hours', { count: course.durationHours }) })
  return badges
}

/**
 * The two texts of a course page, as shown in `language`: the band's short text and the «الوصف» section. The section
 * says only what the band does not: a description equal to the summary (after trimming) is not repeated, and a course
 * with a description but no summary has no short text in the band.
 */
export function courseTextsOf(
  course: { summary: LocalizedLabel | null; description: LocalizedLabel | null },
  language: Language,
): { summary: string | null; description: string | null } {
  const summary = course.summary ? localizedLabel(course.summary, language).trim() : ''
  const description = course.description ? localizedLabel(course.description, language).trim() : ''
  return { summary: summary || null, description: description && description !== summary ? description : null }
}

/** A lesson's length in whole minutes (at least one), or null without a length. */
export function durationMinutes(seconds: number | null | undefined): number | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
  return Math.max(1, Math.round(seconds / 60))
}

/** True for the course page's «this course does not exist» answer — never for a closed catalog. */
export function isPublicCourseGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && !isCatalogNotPublic(error)
}

/** The i18n key of a failure other than a closed catalog or a missing course. */
export function publicFailureKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'publicCatalog.errors.network'
  if (error.status === 429 || error.code === 'rate_limited') return 'publicCatalog.errors.rate_limited'
  return 'publicCatalog.errors.server'
}

/**
 * Where «سجّل في هذه الدورة» leads once the visitor has signed in: the course in the signed-in catalog with the enroll
 * intent, which scrolls to its classes (the learner still chooses and confirms — nothing enrolls by itself).
 */
export function enrollIntentPath(courseId: string): string {
  return `/catalog/${encodeURIComponent(courseId)}?intent=enroll`
}

/**
 * Whether a visitor may create an account (API-205, PORTAL-04): by e-mail (`selfRegistration`) or through Google
 * (`googleSignUp`). Read defensively — only a literal `true` opens it; a server that sends neither, a failed read or any
 * other value reads as closed.
 */
export function accountCreationOpen(academy: { selfRegistration?: unknown; googleSignUp?: unknown } | null | undefined): boolean {
  return academy?.selfRegistration === true || academy?.googleSignUp === true
}

/** The sign-in page with the enroll intent as its `returnTo` (always a path of this site — `enrollIntentPath()`). */
export function visitorSignInPath(courseId: string): string {
  return `/login?returnTo=${encodeURIComponent(enrollIntentPath(courseId))}`
}

/** The new-account page with the same `returnTo`. */
export function visitorRegisterPath(courseId: string): string {
  return `/register?returnTo=${encodeURIComponent(enrollIntentPath(courseId))}`
}
