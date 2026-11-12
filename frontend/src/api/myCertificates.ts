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
