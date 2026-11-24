// The course catalog and self-service enrollment (MOD-19, roadmap §4p):
// API-219..API-223. Types mirror backend/src/catalog/catalog.dto.ts and
// backend/src/enrollments/enrollment-requests.dto.ts. Reading needs
// `courses.read` (every seeded role holds it); enrolling oneself needs
// `enrollments.self_enroll` and the `student` role; «my requests» is
// ownership. The server decides everything — `enrollable`/`blocker` say what
// API-221 would answer, in its refusal order.
// PORTAL-04: every card and detail names the course's school subject (`subject`,
// localized name only) beside its difficulty (`level`), and API-219 takes a
// `subjectId` filter (additive).
import { apiRequest } from './client'
import type { ClassStatus } from './classes'
import type { CoursePricing } from './courses'
import type { EnrollmentSource, EnrollmentStatus, RequestPaymentState } from './enrollments'
import type { LocalizedLabel } from './users'

/** `REQUEST_STATES`: what the student and the office see of a request. */
export const REQUEST_STATES = ['pending_payment', 'pending_approval', 'enrolled', 'completed', 'withdrawn', 'rejected', 'cancelled'] as const
export type RequestState = (typeof REQUEST_STATES)[number]

/** Why API-221 would refuse the reader now, in its refusal order. */
export const CATALOG_BLOCKERS = ['not_allowed', 'request_pending', 'already_enrolled', 'not_open', 'class_full', 'price_unavailable'] as const
export type CatalogBlocker = (typeof CATALOG_BLOCKERS)[number]

export type SelfServiceReason = 'no_permission' | 'not_a_student'

export interface CatalogTeacher {
  fullName: string
  displayName: string | null
}

export interface CatalogLevel {
  id: string
  code: string
  name: LocalizedLabel
}

/** PORTAL-04: the course's school subject — never its difficulty (`level`). */
export interface CatalogSubject {
  id: string
  name: LocalizedLabel
}

export interface CatalogPrice {
  amount: number
  currency: string
  installments: number
}

/** `CatalogCourseCardDto` (API-219). */
export interface CatalogCourseCard {
  id: string
  code: string
  name: LocalizedLabel
  summary: LocalizedLabel | null
  coverImageUrl: string | null
  level: CatalogLevel | null
  /** PORTAL-04: null for a course without a subject. */
  subject: CatalogSubject | null
  durationHours: number | null
  sessionsCount: number | null
  syllabusCount: number
  pricing: CoursePricing
  /** null for a free course, or a paid one whose plan cannot price a request now. */
  price: CatalogPrice | null
  /** Classes open to self-service now. */
  openClasses: number
  /** Of those, the ones with a free seat (and a usable price). */
  availableClasses: number
  /** Lead teachers of the open classes, by name only (at most five). */
  teachers: CatalogTeacher[]
  mine: { enrolled: boolean; pending: boolean }
}

export interface CatalogList {
  items: CatalogCourseCard[]
  nextCursor: string | null
}

export interface CatalogSlot {
  /** 0 = Sunday */
  weekday: number
  startTime: string
  endTime: string
  /** The room's branch zone, else the academy's (D-R41). */
  timeZone: string
  effectiveFrom: string
  effectiveTo: string | null
}

export interface CatalogClass {
  id: string
  code: string
  name: LocalizedLabel
  status: ClassStatus
  startsOn: string | null
  endsOn: string | null
  capacity: number
  enrolledCount: number
  seatsLeft: number
  leadTeacher: CatalogTeacher | null
  /** Weekly slots effective today or later — not confirmed lessons. */
  schedule: CatalogSlot[]
  selfEnrollment: boolean
  /** API-221 would accept the reader now. */
  enrollable: boolean
  blocker: CatalogBlocker | null
  myEnrollment: { id: string; status: EnrollmentStatus; state: RequestState } | null
}

export interface CatalogSyllabusItem {
  title: LocalizedLabel
  description: LocalizedLabel | null
  estimatedMinutes: number | null
}

/** `CatalogCourseDetailDto` (API-220). */
export interface CatalogCourseDetail extends CatalogCourseCard {
  description: LocalizedLabel | null
  minAge: number | null
  maxAge: number | null
  /** Titles and estimates only — lessons and materials stay behind an active enrollment. */
  syllabus: CatalogSyllabusItem[]
  /** Classes open to self-service now, and every class holding the reader's own enrollment or pending request. */
  classes: CatalogClass[]
  selfService: { allowed: boolean; reason: SelfServiceReason | null }
}

export interface ListCatalogParams {
  q?: string
  levelId?: string
  /** PORTAL-04 */
  subjectId?: string
  pricing?: CoursePricing
  available?: boolean
  /** 1–100, server default 24. */
  limit?: number
  cursor?: string
}

// ---------------------------------------------------------------------------
// The request view (MyEnrollmentRequestDto) — API-221 answer, API-222/223
// ---------------------------------------------------------------------------

export interface RequestPaymentLine {
  id: string
  number: string
  amount: number
  method: string
  status: 'completed' | 'reversed'
  paidAt: string
}

export interface RequestInvoice {
  id: string
  number: string | null
  status: 'draft' | 'issued' | 'cancelled'
  total: number
  paid: number
  balance: number
  currency: string
  issuedAt: string | null
  /** API-225 only, for finance readers; null otherwise. */
  payments: RequestPaymentLine[] | null
}

export interface RequestPayment {
  state: RequestPaymentState
  /** true while the course is paid or an invoice was issued for the enrollment. */
  required: boolean
  total: number
  paid: number
  balance: number
  currency: string | null
  /** Every invoice linked to the enrollment, cancelled ones included. */
  invoices: RequestInvoice[]
}

export interface RequestClass {
  id: string
  code: string
  name: LocalizedLabel
  status: ClassStatus
  startsOn: string | null
  endsOn: string | null
  capacity: number
  enrolledCount: number
  leadTeacher: CatalogTeacher | null
}

export interface RequestCourse {
  id: string
  code: string
  name: LocalizedLabel
  coverImageUrl: string | null
  pricing: CoursePricing
}

/** `MyEnrollmentRequestDto`: the id is the enrollment id. */
export interface MyEnrollmentRequest {
  id: string
  status: EnrollmentStatus
  state: RequestState
  source: EnrollmentSource
  /** null only for a free self-service enrollment (never a request). */
  requestedAt: string | null
  decidedAt: string | null
  rejectionReason: string | null
  class: RequestClass
  course: RequestCourse
  payment: RequestPayment
}

export interface MyEnrollmentRequestList {
  /** Newest request first. */
  items: MyEnrollmentRequest[]
}

export interface CatalogEnrollResult {
  /** enrolled = a free course, active at once; requested = a paid course, pending with an invoice. */
  outcome: 'enrolled' | 'requested'
  enrollment: MyEnrollmentRequest
}

export const CATALOG_PATH = '/api/catalog/courses'

/** `/api/catalog/courses?…` with the non-empty parameters only (trimmed search). */
export function catalogPath(params: ListCatalogParams = {}): string {
  const search = new URLSearchParams()
  const q = params.q?.trim()
  if (q) search.set('q', q)
  if (params.levelId) search.set('levelId', params.levelId)
  if (params.subjectId) search.set('subjectId', params.subjectId)
  if (params.pricing) search.set('pricing', params.pricing)
  if (params.available !== undefined) search.set('available', String(params.available))
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  if (params.cursor) search.set('cursor', params.cursor)
  const query = search.toString()
  return query ? `${CATALOG_PATH}?${query}` : CATALOG_PATH
}

/** API-219 */
export function listCatalog(params: ListCatalogParams = {}, signal?: AbortSignal): Promise<CatalogList> {
  return apiRequest<CatalogList>(catalogPath(params), { signal })
}

/** API-220 */
export function getCatalogCourse(courseId: string, signal?: AbortSignal): Promise<CatalogCourseDetail> {
  return apiRequest<CatalogCourseDetail>(`${CATALOG_PATH}/${encodeURIComponent(courseId)}`, { signal })
}

/** API-221 — no body. */
export function enrollInClass(classId: string): Promise<CatalogEnrollResult> {
  return apiRequest<CatalogEnrollResult>(`/api/catalog/classes/${encodeURIComponent(classId)}/enroll`, { method: 'POST', body: {} })
}

/** API-222 */
export function listMyEnrollmentRequests(signal?: AbortSignal): Promise<MyEnrollmentRequestList> {
  return apiRequest<MyEnrollmentRequestList>('/api/me/enrollment-requests', { signal })
}

/** API-223 */
export function cancelMyEnrollmentRequest(enrollmentId: string): Promise<MyEnrollmentRequest> {
  return apiRequest<MyEnrollmentRequest>(`/api/me/enrollment-requests/${encodeURIComponent(enrollmentId)}/cancel`, { method: 'POST', body: {} })
}
