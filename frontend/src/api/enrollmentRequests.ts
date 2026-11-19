// The office's enrollment requests (MOD-19, roadmap §4p): API-224 (list) and
// API-225 (detail), both `enrollments.manage`. Types mirror
// backend/src/enrollments/enrollment-requests.dto.ts. A request is approved or
// rejected through API-059 (`changeEnrollmentStatus()` in ./enrollments, actions
// `approve` / `reject`) and its payment is recorded through API-151 with
// `payments.record` — the server refuses an approval while any issued invoice
// of the enrollment has a balance (409 payment_required).
import { apiRequest } from './client'
import type { MyEnrollmentRequest } from './catalog'
import type { EnrollmentStudent } from './enrollments'

/** The office list's filters: `pending` = both pending states; `approved` = enrolled, completed or withdrawn after approval. */
export const REQUEST_LIST_STATES = ['pending', 'pending_payment', 'pending_approval', 'approved', 'rejected', 'cancelled', 'all'] as const
export type RequestListState = (typeof REQUEST_LIST_STATES)[number]

/** Why `approve` would be refused now (pending requests only). */
export type ApproveBlocker = 'payment_required' | 'class_not_enrollable' | 'class_full'

/** `EnrollmentRequestDto`: the request view plus the student in the caller's projection and what can be done now. */
export interface EnrollmentRequest extends MyEnrollmentRequest {
  student: EnrollmentStudent
  allowedActions: Array<'approve' | 'reject'>
  approveBlocker: ApproveBlocker | null
}

export interface EnrollmentRequestList {
  /** Newest request first. */
  items: EnrollmentRequest[]
  nextCursor: string | null
  /** Pending requests over the whole academy (the office badge). */
  pendingCount: number
}

export interface ListEnrollmentRequestsParams {
  /** Server default `pending`. */
  state?: RequestListState
  classId?: string
  courseId?: string
  /** Student name or class code, 1–100 characters. */
  q?: string
  limit?: number
  cursor?: string
}

export const ENROLLMENT_REQUESTS_PATH = '/api/enrollment-requests'

export function enrollmentRequestsPath(params: ListEnrollmentRequestsParams = {}): string {
  const search = new URLSearchParams()
  if (params.state) search.set('state', params.state)
  if (params.classId) search.set('classId', params.classId)
  if (params.courseId) search.set('courseId', params.courseId)
  const q = params.q?.trim()
  if (q) search.set('q', q)
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  if (params.cursor) search.set('cursor', params.cursor)
  const query = search.toString()
  return query ? `${ENROLLMENT_REQUESTS_PATH}?${query}` : ENROLLMENT_REQUESTS_PATH
}

/** API-224 */
export function listEnrollmentRequests(params: ListEnrollmentRequestsParams = {}, signal?: AbortSignal): Promise<EnrollmentRequestList> {
  return apiRequest<EnrollmentRequestList>(enrollmentRequestsPath(params), { signal })
}

/** API-225 — the payment lines of each invoice need a finance read key (null otherwise). */
export function getEnrollmentRequest(enrollmentId: string, signal?: AbortSignal): Promise<EnrollmentRequest> {
  return apiRequest<EnrollmentRequest>(`${ENROLLMENT_REQUESTS_PATH}/${encodeURIComponent(enrollmentId)}`, { signal })
}
