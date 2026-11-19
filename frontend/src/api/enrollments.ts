// Enrollments (MOD-05-T04/T05): API-057..API-060. Types mirror
// backend/src/enrollments/enrollments.dto.ts and my-classes.dto.ts; every call
// goes through apiRequest (Bearer header, refresh-and-retry on 401). The
// server decides who may read a roster (D-R16: `enrollments.manage`, or a
// teacher assigned to the class) and what each caller sees of a student
// (contact fields need `users.read_contact`, the withdrawal reason needs
// `enrollments.manage`); «my classes» is ownership without a permission key.
import { apiRequest } from './client'
import type { ClassStatus } from './classes'
import type { LocalizedLabel, UserStatus } from './users'

export const ENROLLMENT_STATUSES = ['pending', 'active', 'completed', 'withdrawn', 'cancelled'] as const
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number]

/** MOD-19: `approve` (pending → active, every issued invoice paid) and `reject` (pending → cancelled, a reason required) act on a request. */
export const ENROLLMENT_STATUS_ACTIONS = ['withdraw', 'complete', 'cancel', 'reactivate', 'approve', 'reject'] as const
export type EnrollmentStatusAction = (typeof ENROLLMENT_STATUS_ACTIONS)[number]

export const ENROLLMENT_SOURCES = ['admin', 'self', 'import'] as const
export type EnrollmentSource = (typeof ENROLLMENT_SOURCES)[number]

/**
 * MOD-19 (D-R125): the payment state of a request over the issued invoices of
 * its enrollment — `not_required` (free, nothing invoiced), `missing` (paid
 * course, no issued invoice), `unpaid`, `partial`, `paid`.
 */
export const REQUEST_PAYMENT_STATES = ['not_required', 'missing', 'unpaid', 'partial', 'paid'] as const
export type RequestPaymentState = (typeof REQUEST_PAYMENT_STATES)[number]

/** `EnrollmentStudentDto`: the caller's projection (D-R07) — contact fields are null without `users.read_contact`. */
export interface EnrollmentStudent {
  id: string
  fullName: string
  fullNameLatin: string | null
  displayName: string | null
  avatarUrl: string | null
  status: UserStatus
  email: string | null
  username: string | null
  phone: string | null
  /** Set when the account was soft-deleted after enrolling (the enrollment stays). */
  deletedAt: string | null
}

/** `EnrollmentDto` (API-057..API-059). */
export interface Enrollment {
  id: string
  classId: string
  status: EnrollmentStatus
  source: EnrollmentSource
  /** First enrollment; kept on reactivation. */
  enrolledAt: string
  /** Last time the enrollment became active. */
  activatedAt: string | null
  completedAt: string | null
  withdrawnAt: string | null
  /** Null for callers without `enrollments.manage` (an assigned teacher never sees it). */
  withdrawalReason: string | null
  /** MOD-19: when the current request was made; null for an enrollment that was never a request. */
  requestedAt: string | null
  rejectedAt: string | null
  /** Null for callers without `enrollments.manage`. */
  rejectionReason: string | null
  /** MOD-19: for a `pending` request only — computed from its issued invoices; null otherwise. */
  paymentState: RequestPaymentState | null
  student: EnrollmentStudent
  createdAt: string
  updatedAt: string
}

export interface EnrollmentList {
  /** In enrollment order (time-ordered primary key). */
  items: Enrollment[]
  nextCursor: string | null
}

export interface ListEnrollmentsParams {
  status?: EnrollmentStatus
  /** 1–100, server default 50. */
  limit?: number
  cursor?: string
}

/**
 * Body of API-058 (`CreateEnrollmentDto`): an invited or active user holding the `student` role; starts `active` (D-R18)
 * for a free course — for a paid one (MOD-19, D-R127) a `pending` request with an issued invoice.
 */
export interface CreateEnrollmentInput {
  studentId: string
}

/** Body of API-059 (`ChangeEnrollmentStatusDto`): `reason` goes to the audit event, to `withdrawalReason` on withdraw and to `rejectionReason` on reject (required there). */
export interface ChangeEnrollmentStatusInput {
  action: EnrollmentStatusAction
  reason?: string
}

// ---------------------------------------------------------------------------
// API-060 — my classes (MyClassItemDto)
// ---------------------------------------------------------------------------

/** `self` = the caller is the student; `child` = a student linked to the caller as guardian. */
export type MyClassRelation = 'self' | 'child'

/** The enrolled student: identity only, never contact fields. */
export interface MyClassStudent {
  id: string
  fullName: string
  displayName: string | null
}

export interface MyClassCourse {
  id: string
  code: string
  name: LocalizedLabel
}

/** The lead teacher by name only (no id, no contact fields). */
export interface MyClassTeacher {
  fullName: string
  displayName: string | null
}

export interface MyClassSummary {
  id: string
  code: string
  name: LocalizedLabel
  status: ClassStatus
  /** `YYYY-MM-DD` */
  startsOn: string | null
  endsOn: string | null
  course: MyClassCourse
  /** Null while the class has no lead teacher. */
  leadTeacher: MyClassTeacher | null
}

export interface MyClassItem {
  enrollmentId: string
  enrollmentStatus: EnrollmentStatus
  enrolledAt: string
  completedAt: string | null
  /** Set while the enrollment is `withdrawn`; the reason is never shown here. */
  withdrawnAt: string | null
  relation: MyClassRelation
  student: MyClassStudent
  class: MyClassSummary
}

export interface MyClassList {
  /** Newest enrollment first; empty for a user without enrollments or linked children. */
  items: MyClassItem[]
}

export interface ListMyClassesParams {
  /** One status; absent = `active` and `completed` (the server default). */
  status?: EnrollmentStatus
}

// ---------------------------------------------------------------------------
// Paths and calls
// ---------------------------------------------------------------------------

export const ENROLLMENTS_PATH = '/api/enrollments'
export const MY_CLASSES_PATH = '/api/me/classes'

const rosterPath = (classId: string) => `/api/classes/${encodeURIComponent(classId)}/enrollments`

/** `/api/classes/:id/enrollments?…` with the non-empty parameters only. */
export function enrollmentsListPath(classId: string, params: ListEnrollmentsParams = {}): string {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${rosterPath(classId)}?${search}` : rosterPath(classId)
}

/** `/api/me/classes?…` with the status only when given. */
export function myClassesPath(params: ListMyClassesParams = {}): string {
  return params.status ? `${MY_CLASSES_PATH}?status=${encodeURIComponent(params.status)}` : MY_CLASSES_PATH
}

/** API-057 (`enrollments.read` + manage-or-assigned): 404 `class_not_found` for a roster the caller may not read. */
export function listEnrollments(classId: string, params: ListEnrollmentsParams = {}, signal?: AbortSignal): Promise<EnrollmentList> {
  return apiRequest<EnrollmentList>(enrollmentsListPath(classId, params), { signal })
}

/** API-058 (`enrollments.manage`): answers 201 with the new active enrollment. */
export function enrollStudent(classId: string, input: CreateEnrollmentInput): Promise<Enrollment> {
  return apiRequest<Enrollment>(rosterPath(classId), { method: 'POST', body: input })
}

/** API-059 (`enrollments.manage`): answers with the enrollment after the action. */
export function changeEnrollmentStatus(id: string, input: ChangeEnrollmentStatusInput): Promise<Enrollment> {
  return apiRequest<Enrollment>(`${ENROLLMENTS_PATH}/${encodeURIComponent(id)}/status`, { method: 'POST', body: input })
}

/** API-060 (no permission key — ownership): the caller's classes and, as guardian, their children's. */
export function listMyClasses(params: ListMyClassesParams = {}, signal?: AbortSignal): Promise<MyClassList> {
  return apiRequest<MyClassList>(myClassesPath(params), { signal })
}

// ---------------------------------------------------------------------------
// API-200 — one student's enrollments (CH-0226)
// ---------------------------------------------------------------------------

/** `StudentEnrollmentItemDto`: an enrollment of one student with the «my classes» class summary. */
export interface StudentEnrollmentItem {
  id: string
  status: EnrollmentStatus
  source: EnrollmentSource
  enrolledAt: string
  activatedAt: string | null
  completedAt: string | null
  withdrawnAt: string | null
  /** Null for a caller without `enrollments.manage`. */
  withdrawalReason: string | null
  class: MyClassSummary
}

/** API-200: `enrollments.manage` or `invoices.manage`; newest first, every class, no pagination. */
export function listStudentEnrollments(studentId: string, params: { status?: EnrollmentStatus } = {}, signal?: AbortSignal): Promise<{ items: StudentEnrollmentItem[] }> {
  const query = params.status ? `?status=${encodeURIComponent(params.status)}` : ''
  return apiRequest<{ items: StudentEnrollmentItem[] }>(`/api/users/${encodeURIComponent(studentId)}/enrollments${query}`, { signal })
}
