import { describe, expect, it } from 'vitest'
import { makeCertificate, makeClassCertificates, makePreviewItem } from '../test/certificates'
import { ENROLLMENT_IDS, STUDENT_IDS } from '../test/enrollments'
import { chosenEnrollmentIds, eligibleEnrollmentIds, issueBodyOf, issueOutcomeOf } from './certificates.issue'

const [FIRST, SECOND, THIRD] = ENROLLMENT_IDS

const preview = makeClassCertificates({
  issuable: 2,
  items: [
    makePreviewItem({ enrollmentId: FIRST }),
    makePreviewItem({ enrollmentId: SECOND, reason: 'not_passed' }),
    makePreviewItem({ enrollmentId: THIRD }),
  ],
})

describe('certificates.issue', () => {
  it('offers the enrollments the server gave no reason, once the class is completed — none before', () => {
    expect(eligibleEnrollmentIds(preview)).toEqual([FIRST, THIRD])
    expect(eligibleEnrollmentIds({ ...preview, class: { ...preview.class, status: 'running' }, issuable: 0 })).toEqual([])
  })

  it('keeps only the chosen enrollments that are still eligible, in enrollment order', () => {
    expect(chosenEnrollmentIds([THIRD, SECOND, FIRST], [FIRST, THIRD])).toEqual([FIRST, THIRD])
    expect(chosenEnrollmentIds([SECOND], [FIRST, THIRD])).toEqual([])
  })

  it('sends the chosen enrollments, or an empty body — every eligible enrollment of the class', () => {
    expect(issueBodyOf([])).toEqual({})
    expect(issueBodyOf([THIRD])).toEqual({ enrollmentIds: [THIRD] })
  })

  it('counts the answer: the issued certificates and the skipped enrollments by reason, in the server order of the reasons', () => {
    const outcome = issueOutcomeOf({
      issued: [makeCertificate()],
      skipped: [
        { enrollmentId: THIRD, studentId: STUDENT_IDS[2], reason: 'stale' },
        { enrollmentId: SECOND, studentId: STUDENT_IDS[1], reason: 'not_passed' },
        { enrollmentId: FIRST, studentId: STUDENT_IDS[0], reason: 'stale' },
      ],
    })
    expect(outcome).toEqual({ issued: 1, skipped: 3, byReason: [{ reason: 'not_passed', count: 1 }, { reason: 'stale', count: 2 }] })
    expect(issueOutcomeOf({ issued: [], skipped: [] })).toEqual({ issued: 0, skipped: 0, byReason: [] })
  })
})
