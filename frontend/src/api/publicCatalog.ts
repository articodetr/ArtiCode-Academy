// The public course catalog for visitors (MOD-20, D-R138): API-236 GET
// /api/public/catalog/courses and API-237 GET /api/public/catalog/courses/:id.
// Types mirror backend/src/catalog/public-catalog.dto.ts. `@Public()`, 60
// requests per minute per IP, no caller data: the requests carry no access
// token and never refresh a session (a visitor has neither). The server answers
// `404 catalog_not_public` while the academy keeps its catalog closed
// (`settings.catalog.publicBrowsing` not true), published courses only, never a
// teacher name, a class code or a schedule, and of the lessons the titles only.
// PORTAL-04: every card and detail names the course's school subject (`subject`,
// localized name only), and API-236 takes a `subjectId` filter (additive).
import { ApiError, apiRequest } from './client'
import type { CoursePricing } from './courses'
import type { LearningItemKind } from './learning'
import type { LocalizedLabel } from './users'

export interface PublicCatalogLevel {
  id: string
  name: LocalizedLabel
}

/** PORTAL-04: the course's school subject — never its difficulty (`level`). */
export interface PublicCatalogSubject {
  id: string
  name: LocalizedLabel
}

/** The course price (MOD-19, D-R122). */
export interface PublicCatalogPrice {
  amount: number
  currency: string
}

/** One card of API-236. */
export interface PublicCourseCard {
  id: string
  code: string
  name: LocalizedLabel
  summary: LocalizedLabel | null
  coverImageUrl: string | null
  level: PublicCatalogLevel | null
  /** PORTAL-04: null for a course without a subject. */
  subject: PublicCatalogSubject | null
  durationHours: number | null
  sessionsCount: number | null
  /** free = no course plan; paid = a course plan is set (its price may still be unavailable). */
  pricing: CoursePricing
  /** `null` for a free course — and for a paid one whose plan cannot price a request now (never «free» then). */
  price: PublicCatalogPrice | null
  /** Classes open to self-service now. */
  openClasses: number
  /** One of them still has a seat AND, for a paid course, the plan can price a request (`courseOfferOf()` on the server) — false for every paid course whose `price` is null. */
  hasFreeSeat: boolean
  /** Published lessons. */
  lessonCount: number
  /** The groups a learner sees: levels holding a published lesson plus the trailing group of lessons outside every level (= the detail's `outline.length`). */
  levelCount: number
}

export interface PublicCourseList {
  items: PublicCourseCard[]
  nextCursor: string | null
}

/** A lesson of the outline: its title, kind and length only — no id, no content (D-R138). */
export interface PublicOutlineLesson {
  title: LocalizedLabel
  kind: LearningItemKind
  durationSeconds: number | null
}

/** A level of the outline (D-R130): 1-based `number`; `title` null when the level has none. */
export interface PublicOutlineLevel {
  number: number
  title: LocalizedLabel | null
  lessons: PublicOutlineLesson[]
}

/** API-237. */
export interface PublicCourseDetail extends PublicCourseCard {
  description: LocalizedLabel | null
  minAge: number | null
  maxAge: number | null
  outline: PublicOutlineLevel[]
}

export interface ListPublicCatalogParams {
  q?: string
  /** PORTAL-04 */
  subjectId?: string
  /** 1–48, server default 24. */
  limit?: number
  cursor?: string
}

export const PUBLIC_CATALOG_PATH = '/api/public/catalog/courses'

/** `/api/public/catalog/courses?…` with the non-empty parameters only (trimmed search). */
export function publicCatalogPath(params: ListPublicCatalogParams = {}): string {
  const search = new URLSearchParams()
  const q = params.q?.trim()
  if (q) search.set('q', q)
  if (params.subjectId) search.set('subjectId', params.subjectId)
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  if (params.cursor) search.set('cursor', params.cursor)
  const query = search.toString()
  return query ? `${PUBLIC_CATALOG_PATH}?${query}` : PUBLIC_CATALOG_PATH
}

/** API-236 */
export function listPublicCatalog(params: ListPublicCatalogParams = {}, signal?: AbortSignal): Promise<PublicCourseList> {
  return apiRequest<PublicCourseList>(publicCatalogPath(params), { signal, auth: false, retry: false })
}

/** API-237 */
export function getPublicCourse(courseId: string, signal?: AbortSignal): Promise<PublicCourseDetail> {
  return apiRequest<PublicCourseDetail>(`${PUBLIC_CATALOG_PATH}/${encodeURIComponent(courseId)}`, { signal, auth: false, retry: false })
}

/** The academy does not open its catalog to visitors (API-236/237 answer `404 catalog_not_public`). */
export function isCatalogNotPublic(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'catalog_not_public'
}
