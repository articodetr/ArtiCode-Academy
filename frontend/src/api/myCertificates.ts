// «My certificates» (MOD-10-T04 — J-F51): API-135 GET /api/me/certificates.
// Types mirror backend/src/certificates/my-certificates.dto.ts; the call goes
// through apiRequest (Bearer header, refresh-and-retry on 401). Ownership and
// the 7.2 keys (D-R57, the pattern of «my grades» — D-R48): the caller's own
// certificates with `certificates.read_own` (`relation: self`) and — while the
// caller holds the `guardian` role — their linked children's with
// `certificates.read_linked` (`relation: child`); a caller holding neither key
// gets `403 permission_denied`. Issued and revoked certificates, newest first,
// with the serial, the verification code and the snapshot to print — never
// the issuer, the revoker or the revocation reason. No pagination.
import type { Certificate } from './certificates'
import { apiRequest } from './client'
import type { MyClassRelation } from './enrollments'
import type { LocalizedLabel } from './users'

/** `MyCertificateItemDto`: a certificate as its owner sees it — everything to print it, nothing about who issued or revoked it, or why. */
export interface MyCertificateItem extends Omit<Certificate, 'issuedBy' | 'revokedBy' | 'revokeReason'> {
  /** `self` (certificates.read_own) or `child` (certificates.read_linked and the guardian role). */
  relation: MyClassRelation
}

export interface MyCertificateList {
  /** Issued and revoked certificates, newest first. */
  items: MyCertificateItem[]
}

export interface ListMyCertificatesParams {
  /** The certificates of this class only. */
  classId?: string
  /** The certificates of this student only — the caller or one of their linked children. */
  studentId?: string
}

export const MY_CERTIFICATES_PATH = '/api/me/certificates'

/** `/api/me/certificates?…` with the given parameters only, in a fixed order. */
export function myCertificatesPath(params: ListMyCertificatesParams = {}): string {
  const query = new URLSearchParams()
  if (params.classId) query.set('classId', params.classId)
  if (params.studentId) query.set('studentId', params.studentId)
  const search = query.toString()
  return search ? `${MY_CERTIFICATES_PATH}?${search}` : MY_CERTIFICATES_PATH
}

/** API-135. */
export function listMyCertificates(params: ListMyCertificatesParams = {}, signal?: AbortSignal): Promise<MyCertificateList> {
  return apiRequest<MyCertificateList>(myCertificatesPath(params), { signal })
}

// --- API-070/071 (ADR-049, J-F67): the student's way to their own certificate. ---

/** `COMPLETION_STATES` of backend/src/certificates/certificates.policy.ts — keep in sync; the order the server checks them. */
export const COMPLETION_STATES = ['issued', 'revoked', 'not_offered', 'class_not_running', 'lessons_pending', 'no_assessments', 'assessments_pending', 'not_passed', 'ready'] as const
export type CompletionState = (typeof COMPLETION_STATES)[number]

/** `CompletionWorkDto`: one weighted assessment of the class. */
export interface CompletionWork {
  kind: 'exam' | 'assignment'
  id: string
  title: LocalizedLabel
  maxScore: number
  /** Finished and visible to the student: a released exam result, a graded assignment. */
  done: boolean
  /** The student's own score once `done`; null for an excused exam. */
  score: number | null
}

/** `EnrollmentCompletionDto` (API-070). */
export interface EnrollmentCompletion {
  enrollmentId: string
  classId: string
  courseId: string
  state: CompletionState
  lessons: { required: number; completed: number }
  work: CompletionWork[]
  /** Only once every assessment is finished — never a running average (D-R48). */
  grade: { percent: number; label: LocalizedLabel; letter: string | null; isPass: boolean } | null
  /** The issued certificate, else the latest revoked one. */
  certificate: { id: string; serial: string; status: 'issued' | 'revoked' } | null
}

/** `ClaimCertificateResultDto` (API-071). */
export interface ClaimCertificateResult {
  /** false = the student already held this certificate and nothing was written. */
  created: boolean
  certificate: MyCertificateItem
}

const enrollmentPath = (enrollmentId: string) => `/api/me/enrollments/${encodeURIComponent(enrollmentId)}`

/** API-070 — where the student stands on the way to their certificate. */
export function getEnrollmentCompletion(enrollmentId: string, signal?: AbortSignal): Promise<EnrollmentCompletion> {
  return apiRequest<EnrollmentCompletion>(`${enrollmentPath(enrollmentId)}/completion`, { signal })
}

/** API-071 — takes the certificate; 409 `certificate_not_ready { state }` while the server's state is not `ready`. */
export function claimCertificate(enrollmentId: string): Promise<ClaimCertificateResult> {
  return apiRequest<ClaimCertificateResult>(`${enrollmentPath(enrollmentId)}/certificate`, { method: 'POST', body: {} })
}
