// Fixtures for the certificates screens (MOD-10 — J-F51): the shapes of
// API-130..API-134 and API-136 as the backend returns them
// (backend/src/certificates/certificates.dto.ts), plus the permission sets of
// the seeded roles (backend/src/authorization/system-roles.ts). «My
// certificates» (API-135) builds on these in test/myCertificates.ts.
import type { Certificate, CertificateList, CertificatePreviewItem, CertificateVerification, ClassCertificates } from '../api/certificates'
import { CLASS_COURSE_ID, CLASS_ID } from './classes'
import { ENROLLMENT_IDS, STUDENT_IDS, makeEnrollmentStudent } from './enrollments'

export const CERTIFICATE_ID = '0194a000-0000-7000-8000-00000000c001'
export const CERTIFICATE_ID_2 = '0194a000-0000-7000-8000-00000000c002'
/** 20 base32 characters, as `newVerificationCode()` makes them. */
export const VERIFICATION_CODE = 'K7Q2M4XWZPLR5TBC3NHD'

/** academy_admin by seed: every certificate key, plus the class, course and student pickers of the list. */
export const CERTIFICATE_ADMIN_PERMISSIONS = ['certificates.read_all', 'certificates.issue', 'certificates.revoke', 'classes.read', 'classes.manage', 'courses.read', 'users.read']

/** Staff by seed: `certificates.issue` (which opens the list and the details too — D-R57), never `revoke`. */
export const CERTIFICATE_STAFF_PERMISSIONS = ['certificates.issue', 'classes.read', 'classes.manage', 'courses.read', 'users.read']

/** A custom role reading every certificate without issuing or revoking, and without any picker key. */
export const CERTIFICATE_READER_PERMISSIONS = ['certificates.read_all']

const PYTHON_COURSE = { code: 'PY-101', name: { ar: 'أساسيات بايثون', en: 'Python Basics' } }
const PYTHON_CLASS = { code: 'PY-101-A', name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' } }
const VERY_GOOD = { percent: 86.4, label: { ar: 'جيد جداً', en: 'Very good' }, letter: 'B' }

/** The issued certificate of Omar Khaled (PY-101-A, 86.4 «جيد جداً B»), issued by the staff member on 2026-12-21 09:30 UTC. */
export function makeCertificate(overrides: Partial<Certificate> = {}): Certificate {
  return {
    id: CERTIFICATE_ID,
    serial: 'CERT-2026-00001',
    verificationCode: VERIFICATION_CODE,
    status: 'issued',
    enrollmentId: ENROLLMENT_IDS[0],
    class: { id: CLASS_ID, ...PYTHON_CLASS },
    course: { id: CLASS_COURSE_ID, ...PYTHON_COURSE },
    student: { id: STUDENT_IDS[0], fullName: 'عمر خالد', fullNameLatin: 'Omar Khaled', displayName: null },
    grade: { ...VERY_GOOD },
    snapshot: {
      student: { fullName: 'عمر خالد', fullNameLatin: 'Omar Khaled', displayName: null },
      course: { ...PYTHON_COURSE },
      class: { ...PYTHON_CLASS },
      academy: { name: { ar: 'أكاديمية آرتي كود', en: 'ArtiCode Academy' } },
      grade: { ...VERY_GOOD },
      completedAt: '2026-12-20T15:00:00.000Z',
      issuedAt: '2026-12-21T09:30:00.000Z',
    },
    issuedAt: '2026-12-21T09:30:00.000Z',
    issuedBy: { fullName: 'هند الموظفة' },
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    ...overrides,
  }
}

/** The same certificate after the admin revoked it on 2026-12-28 10:00 UTC with a reason. */
export function makeRevokedCertificate(overrides: Partial<Certificate> = {}): Certificate {
  return makeCertificate({
    status: 'revoked',
    revokedAt: '2026-12-28T10:00:00.000Z',
    revokedBy: { fullName: 'مدير الأكاديمية' },
    revokeReason: 'خطأ في رصد الدرجة',
    ...overrides,
  })
}

export function makeCertificateList(items: Certificate[], nextCursor: string | null = null): CertificateList {
  return { items, nextCursor }
}

/** An eligible enrollment of the completed class: completed, a passing final grade that is not stale, no certificate yet. */
export function makePreviewItem(overrides: Partial<CertificatePreviewItem> = {}): CertificatePreviewItem {
  return {
    enrollmentId: ENROLLMENT_IDS[0],
    enrollmentStatus: 'completed',
    student: makeEnrollmentStudent(),
    final: { ...VERY_GOOD, isPass: true, stale: false },
    certificate: null,
    reason: null,
    ...overrides,
  }
}

/** The preview of the completed class PY-101-A with one eligible enrollment. */
export function makeClassCertificates(overrides: Partial<ClassCertificates> = {}): ClassCertificates {
  return {
    class: { id: CLASS_ID, ...PYTHON_CLASS, status: 'completed' },
    issuable: 1,
    items: [makePreviewItem()],
    ...overrides,
  }
}

/** What the public verification of the issued certificate answers (from the snapshot, D-R56). */
export function makeVerification(overrides: Partial<CertificateVerification> = {}): CertificateVerification {
  return {
    serial: 'CERT-2026-00001',
    status: 'issued',
    issuedAt: '2026-12-21T09:30:00.000Z',
    revokedAt: null,
    student: { fullName: 'عمر خالد', fullNameLatin: 'Omar Khaled' },
    course: { ...PYTHON_COURSE },
    grade: { ...VERY_GOOD },
    academy: { name: { ar: 'أكاديمية آرتي كود', en: 'ArtiCode Academy' } },
    ...overrides,
  }
}
