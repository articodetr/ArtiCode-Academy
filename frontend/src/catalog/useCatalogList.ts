// State of «explore courses» (API-219): the filters and the keyset pages of
// the shared useKeysetList (a filter change restarts from the first page).
import { listCatalog } from '../api/catalog'
import type { CatalogCourseCard } from '../api/catalog'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'
import { catalogParams } from './catalog.view'
import type { CatalogFilters } from './catalog.view'

const loadCatalog: KeysetLoader<CatalogCourseCard, CatalogFilters> = (filters, cursor, signal) => listCatalog(catalogParams(filters, cursor), signal)

export const DEFAULT_CATALOG_FILTERS: CatalogFilters = {}

export function useCatalogList() {
  return useKeysetList<CatalogCourseCard, CatalogFilters>(loadCatalog, DEFAULT_CATALOG_FILTERS)
}
