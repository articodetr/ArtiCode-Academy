// Pure rules of the academy's public home page (/home — PORTAL-04, #208):
// how many programs it shows, the state of that section, and whether the
// visitor's «استعرض البرامج» can show. Nothing here decides what the server
// decides. Unit-tested in publicHome.view.test.ts.
//
// Which programs: the server offers no «featured» choice yet (a backend
// requirement — #205), so the page shows the first page of API-236 as the server
// orders it (by course code), at most HOME_PROGRAMS_LIMIT cards — the same
// courses for every visitor, nothing picked or invented by the page.
import { isCatalogPublic } from '../api/academy'
import type { PublicAcademy } from '../api/academy'
import { isCatalogNotPublic } from '../api/publicCatalog'

export const HOME_PROGRAMS_LIMIT = 6

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
