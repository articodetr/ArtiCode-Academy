import { describe, expect, it } from 'vitest'
import { CERTIFICATE_ID_2 } from '../test/certificates'
import { CHILD_STUDENT, makeMyCertificate } from '../test/myCertificates'
import { certificateStudentOptions, certificatesOf, showsCertificateStudents } from './myCertificates.view'

const own = makeMyCertificate()
const child = makeMyCertificate({ id: CERTIFICATE_ID_2, relation: 'child', student: { ...CHILD_STUDENT } })
const otherChild = makeMyCertificate({ id: 'c-3', relation: 'child', student: { id: 'kid-2', fullName: 'أحمد الأحمد', fullNameLatin: null, displayName: null } })

describe('myCertificates.view', () => {
  it('shows the student column to a guardian, and whenever a child’s certificate came back', () => {
    expect(showsCertificateStudents(['student'], [own])).toBe(false)
    expect(showsCertificateStudents(['guardian'], [])).toBe(true)
    expect(showsCertificateStudents(['student'], [own, child])).toBe(true)
  })

  it('offers each student once: the caller first, then the children by name (display name when set)', () => {
    expect(certificateStudentOptions([child, otherChild, own, child])).toEqual([
      { id: own.student.id, name: 'عمر خالد', relation: 'self' },
      { id: 'kid-2', name: 'أحمد الأحمد', relation: 'child' },
      { id: CHILD_STUDENT.id, name: 'ليلى', relation: 'child' },
    ])
  })

  it('keeps the certificates of the chosen student, or every one', () => {
    expect(certificatesOf([own, child, otherChild], CHILD_STUDENT.id)).toEqual([child])
    expect(certificatesOf([own, child], undefined)).toEqual([own, child])
  })
})
