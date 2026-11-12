// Pure rules of «my certificates» (J-F51 on API-135): whether the student
// column shows, the student filter's options and the items it keeps. The
// options come from the certificates already read (API-135 has no pagination),
// so the filter never offers a student without a certificate. No React, no
// i18next instance; unit-tested in myCertificates.view.test.ts.
import type { MyClassRelation } from '../api/enrollments'
import type { MyCertificateItem } from '../api/myCertificates'

/** The student column matters to a guardian, and whenever the server returned a child's certificate. */
export function showsCertificateStudents(roleKeys: readonly string[], items: readonly Pick<MyCertificateItem, 'relation'>[]): boolean {
  return roleKeys.includes('guardian') || items.some((item) => item.relation === 'child')
}

export interface CertificateStudentOption {
  id: string
  name: string
  relation: MyClassRelation
}

function nameOf(student: { fullName: string; displayName: string | null }): string {
  return student.displayName?.trim() || student.fullName
}

/** The distinct students of the certificates: the caller first, then their children by name. */
export function certificateStudentOptions(items: readonly Pick<MyCertificateItem, 'relation' | 'student'>[]): CertificateStudentOption[] {
  const byId = new Map<string, CertificateStudentOption>()
  for (const item of items) if (!byId.has(item.student.id)) byId.set(item.student.id, { id: item.student.id, name: nameOf(item.student), relation: item.relation })
  return [...byId.values()].sort((a, b) => (a.relation === b.relation ? a.name.localeCompare(b.name) : a.relation === 'self' ? -1 : 1))
}

/** The certificates of one student, or every one when none is chosen. */
export function certificatesOf<T extends Pick<MyCertificateItem, 'student'>>(items: readonly T[], studentId: string | undefined): T[] {
  return studentId ? items.filter((item) => item.student.id === studentId) : [...items]
}
