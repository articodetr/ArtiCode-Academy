// Pure rules of the public catalog (MOD-20, D-R138): the request of a page,
// how a card words whether a class is open, a level's name (D-R130), a lesson's
// length, what a failure says and where «سجّل في هذه الدورة» leads. Nothing
// here decides what the server decides. Unit-tested in publicCatalog.view.test.ts.
import { ApiError } from '../api/client'
import { levelOrdinalWord } from '../common/levelOrdinal'
import { isCatalogNotPublic } from '../api/publicCatalog'
import type { ListPublicCatalogParams, PublicCourseCard, PublicCourseList, PublicOutlineLevel } from '../api/publicCatalog'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'
import type { PublicViewer } from './publicViewer'

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

/** How many placeholder tints a card without a cover can take (publicCatalog.css `.public-card__placeholder--t0` … `--t4`). */
export const PLACEHOLDER_TINTS = 5

/** A stable tint for a course without a cover (PORTAL-04 PR-1 redesign): the same course always gets the same one. */
export function placeholderTintOf(id: string): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % PLACEHOLDER_TINTS
}

export const AVAILABILITY_COLORS: Record<Exclude<PublicAvailability, 'priceUnavailable'>, string> = {
  available: 'green',
  full: 'orange',
  closed: 'default',
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

export interface CardSubscribeTarget {
  to: string
  /** The sign-in page's return path. */
  state?: { from: string }
}

/**
 * Where a public card's subscribe button leads, or null when it shows no button: only while the server says the course
 * takes an enrollment now, for a visitor (through the sign-in, keeping the course) or a student (to the course's
 * classes). Staff and guardians cannot enroll themselves (API-221 needs the `student` role), and nothing is offered
 * while the session is still being restored. Nothing enrolls here: the learner chooses a class and confirms.
 */
export function cardSubscribeTarget(
  course: Pick<PublicCourseCard, 'id' | 'openClasses' | 'hasFreeSeat' | 'pricing' | 'price'>,
  viewer: PublicViewer,
  isStudent: boolean,
): CardSubscribeTarget | null {
  if (publicEnrollStateOf(course) !== 'enrollable') return null
  if (viewer === 'visitor') return { to: '/login', state: { from: enrollIntentPath(course.id) } }
  if (viewer === 'learner' && isStudent) return { to: enrollIntentPath(course.id) }
  return null
}
