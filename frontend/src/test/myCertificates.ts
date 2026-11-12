// Fixtures for «my certificates» (MOD-10-T04 — J-F51): the shapes of API-135 as
// the backend returns them (my-certificates.dto.ts) — a CertificateDto without
// the issuer, the revoker or the reason, plus `relation`. The certificate part
// reuses test/certificates.ts so the class, course and snapshot are the same.
import type { Certificate } from '../api/certificates'
import type { MyCertificateItem, MyCertificateList } from '../api/myCertificates'
import { makeCertificate } from './certificates'

/** A child of the signed-in guardian, with a certificate of their own. */
export const CHILD_STUDENT = { id: '0194b000-0000-7000-8000-00000000b002', fullName: 'ليلى الأحمد', fullNameLatin: 'Layla Al-Ahmad', displayName: 'ليلى' }

/** The owner's view of a certificate: everything to print it, never who issued or revoked it, or why. */
export function toMyCertificate(certificate: Certificate, relation: MyCertificateItem['relation'] = 'self'): MyCertificateItem {
  return {
    id: certificate.id,
    serial: certificate.serial,
    verificationCode: certificate.verificationCode,
    status: certificate.status,
    enrollmentId: certificate.enrollmentId,
    class: certificate.class,
    course: certificate.course,
    student: certificate.student,
    grade: certificate.grade,
    snapshot: certificate.snapshot,
    issuedAt: certificate.issuedAt,
    revokedAt: certificate.revokedAt,
    relation,
  }
}

/** The signed-in student's own issued certificate (relation `self`). */
export function makeMyCertificate(overrides: Partial<MyCertificateItem> = {}): MyCertificateItem {
  return { ...toMyCertificate(makeCertificate()), ...overrides }
}

export function makeMyCertificateList(items: MyCertificateItem[]): MyCertificateList {
  return { items }
}
