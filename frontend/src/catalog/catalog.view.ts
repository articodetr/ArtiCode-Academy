// Pure rules of the learner's catalog screens (MOD-19, roadmap §4p): which
// cover may be loaded, how a card words its availability, which classes the
// details page puts forward, the colour of a request state and how «my
// courses» groups the enrollments of API-060 by course. Nothing here decides
// what the server decides — `enrollable`, `blocker`, the request state and the
// payment state are always the server's. Unit-tested in catalog.view.test.ts.
import { brandLogoSrc } from '../academy/academy.brand'
import type { CatalogClass, CatalogCourseCard, CatalogCourseDetail, ListCatalogParams, RequestState } from '../api/catalog'
import type { CoursePricing } from '../api/courses'

/** The filters of the catalog list (API-219); `undefined` = no filter. */
export interface CatalogFilters {
  q?: string
  pricing?: CoursePricing
  levelId?: string
  /** Only `true` is sent: the toggle narrows, it never asks for the unavailable ones. */
  available?: true
}

export const CATALOG_PAGE_SIZE = 24
/** Upper bound of `q` on API-219 (1–100 characters after trim). */
export const CATALOG_SEARCH_MAX_LENGTH = 100
/** How long the search box waits after the last keystroke before it asks the server. */
export const CATALOG_SEARCH_DELAY_MS = 300

export function catalogParams(filters: CatalogFilters, cursor: string | undefined): ListCatalogParams {
  const params: ListCatalogParams = { limit: CATALOG_PAGE_SIZE }
  const q = filters.q?.trim()
  if (q) params.q = q.slice(0, CATALOG_SEARCH_MAX_LENGTH)
  if (filters.pricing) params.pricing = filters.pricing
  if (filters.levelId) params.levelId = filters.levelId
  if (filters.available) params.available = true
  if (cursor) params.cursor = cursor
  return params
}

/** True when a filter narrows the list (the empty state then offers to clear them). */
export function isCatalogNarrowed(filters: CatalogFilters): boolean {
  return Boolean(filters.q?.trim() || filters.pricing || filters.levelId || filters.available)
}

/**
 * The cover image address, or null for none: the header logo's rule (J-F24) —
 * an absolute `https:` URL, an `http:` one only while the page itself is
 * served over `http:` (never mixed content), or a path on this origin.
 */
export function coverSrc(url: string | null | undefined, origin: string = window.location.origin): string | null {
  return brandLogoSrc(url, origin)
}

/** How a card words whether one can enroll now — from the server's counts only. */
export type CardAvailability = 'available' | 'priceUnavailable' | 'full' | 'closed'

export function cardAvailability(card: Pick<CatalogCourseCard, 'pricing' | 'price' | 'openClasses' | 'availableClasses'>): CardAvailability {
  if (card.availableClasses > 0) return 'available'
  if (card.openClasses === 0) return 'closed'
  // Open classes but none takes a request now: a paid course without a usable price, else every seat taken.
  return card.pricing === 'paid' && card.price === null ? 'priceUnavailable' : 'full'
}

export const AVAILABILITY_COLORS: Record<CardAvailability, string> = {
  available: 'green',
  priceUnavailable: 'orange',
  full: 'red',
  closed: 'default',
}

/** The classes the details page offers a button for: the server's `enrollable` ones, in its order. */
export function enrollableClasses(detail: Pick<CatalogCourseDetail, 'classes' | 'selfService'>): CatalogClass[] {
  if (!detail.selfService.allowed) return []
  return detail.classes.filter((klass) => klass.enrollable)
}

/**
 * True when the details page says «enrollment is not available right now»:
 * the reader may enroll, no class takes them now, and none holds their own
 * enrollment or request (that one is worded on its class instead).
 */
export function enrollmentUnavailable(detail: Pick<CatalogCourseDetail, 'classes' | 'selfService'>): boolean {
  if (!detail.selfService.allowed) return false
  if (detail.classes.some((klass) => klass.enrollable)) return false
  return !detail.classes.some((klass) => klass.myEnrollment !== null)
}

/** The reader's own place in a course, from their enrollments in its classes (the server's request states). */
export type CourseStanding =
  | { kind: 'studying'; klass: CatalogClass }
  | { kind: 'completed'; klass: CatalogClass }
  | { kind: 'pending'; klass: CatalogClass; state: Extract<RequestState, 'pending_payment' | 'pending_approval'> }

/**
 * Whether the reader studies this course now, has completed it, or waits on a request for it — in that order, so an
 * active enrollment wins over an older completed one or a request in another class. Null when none: a rejected,
 * cancelled or withdrawn row opens nothing (the page then offers the classes as usual). PORTAL-04: a student who
 * already studies the course is offered «واصل التعلم» instead of a second request.
 */
export function courseStandingOf(detail: Pick<CatalogCourseDetail, 'classes'>): CourseStanding | null {
  const withState = (state: RequestState) => detail.classes.find((klass) => klass.myEnrollment?.state === state)
  const studying = withState('enrolled')
  if (studying) return { kind: 'studying', klass: studying }
  const completed = withState('completed')
  if (completed) return { kind: 'completed', klass: completed }
  for (const state of ['pending_approval', 'pending_payment'] as const) {
    const pending = withState(state)
    if (pending) return { kind: 'pending', klass: pending, state }
  }
  return null
}

/**
 * The class whose confirmation opens by itself for a learner who pressed subscribe: the one class that takes them,
 * when they may enroll and have no place in the course yet. Null otherwise — with two or more classes the learner
 * chooses. This only picks what to ask about; the enrollment still waits for the learner's own confirmation.
 */
export function autoConfirmClass(detail: Pick<CatalogCourseDetail, 'classes' | 'selfService'>): CatalogClass | null {
  if (courseStandingOf(detail) !== null) return null
  const enrollable = enrollableClasses(detail)
  return enrollable.length === 1 ? enrollable[0]! : null
}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** `0` (Sunday) … `6` → the key of the `days` section. */
export function weekdayKey(weekday: number): (typeof WEEKDAY_KEYS)[number] {
  return WEEKDAY_KEYS[((weekday % 7) + 7) % 7]!
}

export const REQUEST_STATE_COLORS: Record<RequestState, string> = {
  pending_payment: 'gold',
  pending_approval: 'blue',
  enrolled: 'green',
  completed: 'cyan',
  withdrawn: 'orange',
  rejected: 'red',
  cancelled: 'default',
}

/** The amount shown for a price: two decimals, as every finance screen. */
export function priceAmount(amount: number): string {
  return amount.toFixed(2)
}
