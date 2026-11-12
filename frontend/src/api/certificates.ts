// Certificates (MOD-10 — J-F51): API-130 GET /api/certificates, API-131 GET
// /api/certificates/:id, API-132 POST /api/classes/:id/certificates, API-133
// POST /api/certificates/:id/revoke, API-134 GET /api/certificates/verify/:code
// (public) and API-136 GET /api/classes/:id/certificates. Types mirror
// backend/src/certificates/certificates.dto.ts field by field; every call goes
// through apiRequest (Bearer header, refresh-and-retry on 401) except the
// public verification, which sends no token and never refreshes (as the
// invitation preview of api/account.ts). Reading — the list, a certificate and
// a class's preview — needs `certificates.read_all` OR `certificates.issue`
// (D-R57, either one; the server checks), issuing `certificates.issue` and
// revoking `certificates.revoke`, academy-wide without the class visibility of
// D-R16 (D-R52). A certificate's `snapshot` is what is printed: fixed at
// issuance, never changed by a later edit (D-R50, ADR-067). Learners read
// theirs through api/myCertificates.ts (API-135).
import { CLASSES_PATH } from './classes'
import type { ClassStatus } from './classes'
import { apiRequest } from './client'
import type { EnrollmentStatus, EnrollmentStudent } from './enrollments'
import type { LocalizedLabel } from './users'

/** The Prisma enum `certificate_status`: issued, then revoked for good (D-R55). */
export const CERTIFICATE_STATUSES = ['issued', 'revoked'] as const
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number]

/** Why an enrollment gets no certificate (D-R52), in the order the server checks them (`INELIGIBLE_REASONS`). */
export const INELIGIBLE_REASONS = ['already_issued', 'not_completed', 'no_final_grade', 'not_passed', 'stale'] as const
export type IneligibleReason = (typeof INELIGIBLE_REASONS)[number]

/** Mirrors of the DTO limits (backend/src/certificates/certificates.dto.ts). */
export const CERTIFICATES_PAGE_DEFAULT = 50
export const CERTIFICATES_PAGE_MAX = 100
/** `q`: part of the serial, 1..32 characters after trimming (literal, case-insensitive). */
export const CERTIFICATE_QUERY_MAX_LENGTH = 32
/** A revocation reason: 1..500 characters after trimming (D-R55). */
export const REVOKE_REASON_MAX_LENGTH = 500
/** At most this many enrollments in one issuing request. */
export const ISSUE_MAX_ENROLLMENTS = 500

/** `CertificateRefDto`: the class or the course as it is named now. */
export interface CertificateRef {
  id: string
  code: string
  name: LocalizedLabel
}

/** `CertificateStudentDto`: identity only. */
export interface CertificateStudent {
  id: string
  fullName: string
  fullNameLatin: string | null
  displayName: string | null
}

/** `CertificateActorDto`: who issued or revoked, by name only. */
export interface CertificateActor {
  fullName: string
}

/** `CertificateGradeDto`: the final grade and its band at issuance. */
export interface CertificateGrade {
  percent: number
  label: LocalizedLabel
  letter: string | null
}

/** `CertificateSnapshotDto`: what is printed (D-R50) — fixed at issuance. */
export interface CertificateSnapshot {
  /** Without the id. */
  student: Omit<CertificateStudent, 'id'>
  course: { code: string; name: LocalizedLabel }
  class: { code: string; name: LocalizedLabel }
  /** The academy name at issuance. */
  academy: { name: LocalizedLabel }
  grade: CertificateGrade
  /** ISO 8601 — when the enrollment was completed. */
  completedAt: string | null
  /** ISO 8601. */
  issuedAt: string
}

/** `CertificateDto` (API-131, API-132, API-133 and the items of API-130). */
export interface Certificate {
  id: string
  /** `PREFIX-YYYY-NNNNN` (D-R53). */
  serial: string
  /** The public verification code (D-R56): 20 base32 characters. */
  verificationCode: string
  status: CertificateStatus
  enrollmentId: string
  class: CertificateRef
  course: CertificateRef
  /** Identity only. */
  student: CertificateStudent
  grade: CertificateGrade
  snapshot: CertificateSnapshot
  /** ISO 8601. */
  issuedAt: string
  issuedBy: CertificateActor | null
  /** ISO 8601; set once revoked. */
  revokedAt: string | null
  revokedBy: CertificateActor | null
  revokeReason: string | null
}

export interface CertificateList {
  /** Newest first. */
  items: Certificate[]
  nextCursor: string | null
}

/** API-130 query: ANDed filters, newest first, keyset pages (the cursor belongs to the same filters). */
export interface ListCertificatesParams {
  classId?: string
  courseId?: string
  studentId?: string
  status?: CertificateStatus
  /** Part of the serial; trimmed, 1..32 characters (a blank one is never sent). */
  q?: string
  /** 1–100, server default 50. */
  limit?: number
  cursor?: string
}

/** Body of API-133: the required reason (D-R55). */
export interface RevokeCertificateInput {
  reason: string
}

/** Body of API-132: absent `enrollmentIds` = every eligible enrollment of the class. */
export interface IssueCertificatesInput {
  /** 1..500 enrollments of the class, each once (`certificate_request_invalid` otherwise). */
  enrollmentIds?: string[]
}

/** `SkippedEnrollmentDto`: an enrollment that got no certificate, with the reason. */
export interface SkippedEnrollment {
  enrollmentId: string
  studentId: string
  reason: IneligibleReason
}

/** `IssueCertificatesResultDto` (API-132). */
export interface IssueCertificatesResult {
  /** The certificates issued by this request, in enrollment order. */
  issued: Certificate[]
  skipped: SkippedEnrollment[]
}

/** `CertificatePreviewFinalDto`: the final grade fixed by MOD-09. */
export interface CertificatePreviewFinal {
  percent: number
  label: LocalizedLabel
  letter: string | null
  isPass: boolean
  /** A source changed after the final grade was fixed — finalize again first. */
  stale: boolean
}

/** `CertificatePreviewSummaryDto`: the issued certificate of an enrollment. */
export interface CertificatePreviewSummary {
  id: string
  serial: string
  /** ISO 8601. */
  issuedAt: string
}

/** `CertificatePreviewItemDto`: one active or completed enrollment of the class. */
export interface CertificatePreviewItem {
  enrollmentId: string
  enrollmentStatus: EnrollmentStatus
  /** In the caller's D-R07 projection (`EnrollmentStudentDto`). */
  student: EnrollmentStudent
  final: CertificatePreviewFinal | null
  certificate: CertificatePreviewSummary | null
  /** Why no certificate would be issued now; null = eligible. */
  reason: IneligibleReason | null
}

/** `CertificatePreviewClassDto`. */
export interface CertificatePreviewClass {
  id: string
  code: string
  name: LocalizedLabel
  status: ClassStatus
}

/** `ClassCertificatesDto` (API-136). */
export interface ClassCertificates {
  class: CertificatePreviewClass
  /** How many certificates an issuing request would create now (0 unless the class is completed). */
  issuable: number
  /** Every active or completed enrollment, in enrollment order. */
  items: CertificatePreviewItem[]
}

/** `CertificateVerificationDto` (API-134): read from the snapshot — no reason, no internal id (D-R56). */
export interface CertificateVerification {
  serial: string
  /** `revoked` = no longer valid. */
  status: CertificateStatus
  /** ISO 8601. */
  issuedAt: string
  revokedAt: string | null
  student: { fullName: string; fullNameLatin: string | null }
  course: { code: string; name: LocalizedLabel }
  grade: CertificateGrade
  academy: { name: LocalizedLabel }
}

export const CERTIFICATES_PATH = '/api/certificates'

/** `/api/certificates?…` with the given parameters only, in a fixed order (`q` trimmed, a blank one dropped). */
export function certificatesListPath(params: ListCertificatesParams = {}): string {
  const query = new URLSearchParams()
  if (params.classId) query.set('classId', params.classId)
  if (params.courseId) query.set('courseId', params.courseId)
  if (params.studentId) query.set('studentId', params.studentId)
  if (params.status) query.set('status', params.status)
  const q = params.q?.trim()
  if (q) query.set('q', q)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${CERTIFICATES_PATH}?${search}` : CERTIFICATES_PATH
}

export const certificatePath = (id: string) => `${CERTIFICATES_PATH}/${encodeURIComponent(id)}`

/** API-132/API-136 path: the certificates of one class. */
export const classCertificatesPath = (classId: string) => `${CLASSES_PATH}/${encodeURIComponent(classId)}/certificates`

/** API-134 path (public). */
export const verifyCertificatePath = (code: string) => `${CERTIFICATES_PATH}/verify/${encodeURIComponent(code)}`

/** API-130. */
export function listCertificates(params: ListCertificatesParams = {}, signal?: AbortSignal): Promise<CertificateList> {
  return apiRequest<CertificateList>(certificatesListPath(params), { signal })
}

/** API-131: 404 `certificate_not_found` for an unknown id. */
export function getCertificate(id: string, signal?: AbortSignal): Promise<Certificate> {
  return apiRequest<Certificate>(certificatePath(id), { signal })
}

/** API-133: final (D-R55); an already revoked certificate is `409 certificate_revoked`. */
export function revokeCertificate(id: string, input: RevokeCertificateInput): Promise<Certificate> {
  return apiRequest<Certificate>(`${certificatePath(id)}/revoke`, { method: 'POST', body: input })
}

/** API-136: the preview of a class — who would receive a certificate now, and why not. */
export function previewClassCertificates(classId: string, signal?: AbortSignal): Promise<ClassCertificates> {
  return apiRequest<ClassCertificates>(classCertificatesPath(classId), { signal })
}

/** API-132: a completed class only (`409 class_not_completed`); nothing eligible = 200 with `issued: []`. */
export function issueClassCertificates(classId: string, input: IssueCertificatesInput): Promise<IssueCertificatesResult> {
  return apiRequest<IssueCertificatesResult>(classCertificatesPath(classId), { method: 'POST', body: input })
}

/**
 * API-134 (public, 60 requests per minute per IP): no access token is attached,
 * and a 401 never triggers a session refresh. A malformed and an unknown code
 * read the same `404 certificate_not_found`.
 */
export function verifyCertificate(code: string, signal?: AbortSignal): Promise<CertificateVerification> {
  return apiRequest<CertificateVerification>(verifyCertificatePath(code), { signal, auth: false, retry: false })
}
