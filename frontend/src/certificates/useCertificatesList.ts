// State of the certificates table (J-F51): API-130 through the shared keyset
// hook, with the filters the contract supports — part of the serial (`q`), the
// status, the class, the course and the student. Newest first is the server's
// only order (UUIDv7 ids), so there is no order filter; any filter change
// restarts from the first page, as the cursor belongs to the filters it was
// read with.
import { listCertificates } from '../api/certificates'
import type { Certificate, CertificateStatus } from '../api/certificates'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'

export const CERTIFICATE_PAGE_SIZES = [20, 50, 100] as const

export interface CertificatesListFilters {
  /** Part of the serial as typed; trimmed by the request (a blank one narrows nothing). */
  q: string | undefined
  status: CertificateStatus | undefined
  classId: string | undefined
  courseId: string | undefined
  studentId: string | undefined
  limit: (typeof CERTIFICATE_PAGE_SIZES)[number]
}

/** Every certificate, newest first, 20 per page. */
export function defaultCertificateFilters(): CertificatesListFilters {
  return { q: undefined, status: undefined, classId: undefined, courseId: undefined, studentId: undefined, limit: 20 }
}

/** True when the list is narrowed (the page size narrows nothing). */
export function hasActiveCertificateFilters(filters: CertificatesListFilters): boolean {
  return Boolean(filters.q?.trim() || filters.status || filters.classId || filters.courseId || filters.studentId)
}

const loadCertificates: KeysetLoader<Certificate, CertificatesListFilters> = (filters, cursor, signal) =>
  listCertificates(
    {
      q: filters.q,
      status: filters.status,
      classId: filters.classId,
      courseId: filters.courseId,
      studentId: filters.studentId,
      limit: filters.limit,
      cursor,
    },
    signal,
  )

export function useCertificatesList(initialFilters: CertificatesListFilters) {
  return useKeysetList(loadCertificates, initialFilters)
}
