// Pure rules of the academy's public home page (/home — PORTAL-04, #208):
// how many programs it shows, the state of that section, whether the visitor's
// «استعرض البرامج» can show, where the page's «programs» actions lead, and the
// figures it may state. Nothing here decides what the server decides.
// Unit-tested in publicHome.view.test.ts.
//
// Which programs: the server offers no «featured» choice yet (a backend
// requirement — #205), so the page reads one page of API-236 as the server orders
// it (by course code) and shows at most HOME_PROGRAMS_LIMIT of the courses that take
// a learner now (`homeProgramsOf()`) — the same courses for every visitor.
//
// Which figures: only sums of what API-236 itself answers for published courses.
// The page reads one page of HOME_CATALOG_READ_LIMIT cards (the server's maximum);
// when the catalog holds more, every figure is a lower bound and carries a «+».
// No student count, rating or partner exists on the server, so none is ever shown.
import { isCatalogPublic } from '../api/academy'
import type { PublicAcademy } from '../api/academy'
import { isCatalogNotPublic } from '../api/publicCatalog'
import type { PublicCourseCard } from '../api/publicCatalog'
import { availabilityOf } from '../publicCatalog/publicCatalog.view'
import { programsPathFor } from '../publicCatalog/publicViewer'
import type { PublicViewer } from '../publicCatalog/publicViewer'

export const HOME_PROGRAMS_LIMIT = 6
export const HOME_CATALOG_READ_LIMIT = 48

export type HomeProgramsState = 'loading' | 'ready' | 'empty' | 'closed' | 'error'

export function homeProgramsStateOf(reading: { loading: boolean; error: unknown; count: number }): HomeProgramsState {
  if (reading.loading) return 'loading'
  if (reading.error !== null && reading.error !== undefined) return isCatalogNotPublic(reading.error) ? 'closed' : 'error'
  return reading.count > 0 ? 'ready' : 'empty'
}

/**
 * Whether the academy opens its catalog to visitors, as far as the page knows: the programs' own answer first
 * (API-236 — answered = open, `404 catalog_not_public` = closed), else API-205's `catalogPublic`, else null (not known
 * yet — the visitor's «استعرض البرامج» waits rather than flash and vanish).
 */
export function catalogOpenOf(state: HomeProgramsState, academy: Pick<PublicAcademy, 'catalogPublic'> | null): boolean | null {
  if (state === 'ready' || state === 'empty') return true
  if (state === 'closed') return false
  return academy ? isCatalogPublic(academy) : null
}

/**
 * Where a «programs» action of the page leads, or null when this viewer has nowhere to go: a visitor only while the
 * catalog is known to be open, a learner to the signed-in catalog, staff to /courses with `courses.read` (never a 403).
 */
export function homeProgramsPath(viewer: PublicViewer, catalogOpen: boolean | null, canReadCourses: boolean): string | null {
  if (viewer === 'pending') return null
  if (viewer === 'visitor' && catalogOpen !== true) return null
  if (viewer === 'staff' && !canReadCourses) return null
  return programsPathFor(viewer)
}

export interface HomeSelection {
  /** The cards the section shows, in the server's order. */
  cards: PublicCourseCard[]
  /** At least one of them takes a learner now; false = they are shown for reading only. */
  joinable: boolean
}

/**
 * The cards of the home page: the first HOME_PROGRAMS_LIMIT that take a learner now, in the server's order. When none
 * does, the first published ones with their own state, so a new academy's page is not empty. It looks only at the
 * HOME_CATALOG_READ_LIMIT cards read, so an available course past them is not found; the server filter of PR #220 can
 * replace this later.
 */
export function homeProgramsOf(cards: readonly PublicCourseCard[]): HomeSelection {
  const available = cards.filter((card) => availabilityOf(card) === 'available')
  const joinable = available.length > 0
  return { cards: (joinable ? available : cards).slice(0, HOME_PROGRAMS_LIMIT), joinable }
}

export interface HomeStats {
  programs: number
  lessons: number
  hours: number
  openClasses: number
  /** The catalog holds more courses than were read: each figure is «at least». */
  partial: boolean
}

/** The page's figures, summed from the cards the server answered; null without a card. */
export function homeStatsOf(cards: readonly PublicCourseCard[], more: boolean): HomeStats | null {
  if (cards.length === 0) return null
  let lessons = 0
  let hours = 0
  let openClasses = 0
  for (const card of cards) {
    lessons += card.lessonCount
    hours += card.durationHours ?? 0
    openClasses += card.openClasses
  }
  return { programs: cards.length, lessons, hours: Math.floor(hours), openClasses, partial: more }
}

/** A figure with Latin digits and, for a lower bound, a «+». */
export function formatHomeStat(value: number, partial: boolean): string {
  return `${new Intl.NumberFormat('en-US').format(value)}${partial ? '+' : ''}`
}
