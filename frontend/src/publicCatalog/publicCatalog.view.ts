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

/** The cards on screen after «المزيد»: the new page after the old one, a course already shown never twice. */
export function appendCards(current: readonly PublicCourseCard[], page: PublicCourseList['items']): PublicCourseCard[] {
  const shown = new Set(current.map((card) => card.id))
  return [...current, ...page.filter((card) => !shown.has(card.id))]
}

export type PublicAvailability = 'available' | 'full' | 'closed'

/** Whether a class of the course takes a learner now — from the server's counts only. */
export function availabilityOf(card: Pick<PublicCourseCard, 'openClasses' | 'hasFreeSeat'>): PublicAvailability {
  if (card.openClasses === 0) return 'closed'
  return card.hasFreeSeat ? 'available' : 'full'
}

export const AVAILABILITY_COLORS: Record<PublicAvailability, string> = {
  available: 'green',
  full: 'orange',
  closed: 'default',
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
