// J-F68: what a learner still lacks for the automatic certificate — the mirror of `examPassed()`
// (backend/src/certificates/certificates.policy.ts) and the sorting of the server's counts and exams.
import { describe, expect, it } from 'vitest'
import { makeCounts, makeWorkspace, withSecondLevelClosed } from '../learn/learn.fixtures'
import { makeMyCertificate } from '../test/myCertificates'
import { makeMyExam, makeMyExamResult, makeOnlineMyExam, makePublishedMyExam } from '../test/myExams'
import { certificateFor, certificateGaps, examGapOf, examPassed, lessonGapsOf } from './certificateGaps'

describe('examPassed (mirror of certificates.policy.ts)', () => {
  it('passes a score at or above the pass mark, or an excused result', () => {
    expect(examPassed({ passScore: 25, result: makeMyExamResult({ score: 25 }) })).toBe(true)
    expect(examPassed({ passScore: 25, result: makeMyExamResult({ score: 41.5 }) })).toBe(true)
    expect(examPassed({ passScore: 25, result: makeMyExamResult({ status: 'excused', score: null }) })).toBe(true)
  })

  it('fails below the mark, an absence, or no released result', () => {
    expect(examPassed({ passScore: 25, result: makeMyExamResult({ score: 24.99 }) })).toBe(false)
    expect(examPassed({ passScore: 25, result: makeMyExamResult({ status: 'absent', score: null }) })).toBe(false)
    expect(examPassed({ passScore: 25, result: null })).toBe(false)
  })

  it('needs only a score when the exam has no pass mark', () => {
    expect(examPassed({ passScore: null, result: makeMyExamResult({ score: 0 }) })).toBe(true)
  })
})

describe('examGapOf', () => {
  it('sorts the exams of a class by where they stand', () => {
    expect(examGapOf(makePublishedMyExam()).state).toBe('passed')
    expect(examGapOf(makePublishedMyExam({ result: makeMyExamResult({ score: 10 }) }))).toMatchObject({ state: 'failed', score: 10, maxScore: 50, passScore: 25 })
    expect(examGapOf(makePublishedMyExam({ result: makeMyExamResult({ status: 'absent', score: null }) })).state).toBe('absent')
    // A manual exam without a released result: the teacher records it.
    expect(examGapOf(makeMyExam()).state).toBe('awaiting_result')
    expect(examGapOf(makeOnlineMyExam()).state).toBe('not_started')
    expect(examGapOf(makeOnlineMyExam({}, { attemptsUsed: 1, canStart: false, inProgress: { id: 'a1', attemptNo: 1, expiresAt: '2026-11-20T08:00:00.000Z', remainingSeconds: 600 } })).state).toBe(
      'in_progress',
    )
    // Taken, released only when the results are published.
    expect(examGapOf(makeOnlineMyExam({}, { attemptsUsed: 1, canStart: true })).state).toBe('awaiting_result')
  })

  it('keeps the server’s take state', () => {
    const closed = examGapOf(makeOnlineMyExam({}, { canStart: false, blocker: 'not_open_yet' }))
    expect(closed).toMatchObject({ canTake: false, blocker: 'not_open_yet', opensAt: '2026-11-20T07:00:00.000Z', timeZone: 'Asia/Riyadh' })
    const retry = examGapOf(makeOnlineMyExam({ result: makeMyExamResult({ score: 3 }) }, { attemptsUsed: 1, canStart: true, resultsRelease: 'on_submit' }))
    expect(retry).toMatchObject({ state: 'failed', canTake: true })
  })
})

describe('lessonGapsOf', () => {
  it('names the required lessons not completed yet, with their level', () => {
    const gaps = lessonGapsOf(makeWorkspace())
    expect(gaps.map((gap) => gap.id)).toEqual(['i2', 'i3'])
    expect(gaps[0]).toMatchObject({ sectionNumber: 1, opensOn: null })
  })

  it('says when a level opens', () => {
    const gaps = lessonGapsOf(withSecondLevelClosed(makeWorkspace(), '2030-02-01'))
    expect(gaps.find((gap) => gap.id === 'i3')?.opensOn).toBe('2030-02-01')
  })
})

describe('certificateGaps', () => {
  it('counts the lessons left from the server’s numbers', () => {
    const gaps = certificateGaps(makeCounts({ total: 4, required: 3, completed: 1, completedRequired: 1 }), [])
    expect(gaps).toMatchObject({ lessonsLeft: 2, lessonsRequired: 3, lessonsDone: 1, complete: false })
  })

  it('is complete only with every lesson done and every exam passed', () => {
    const done = makeCounts({ total: 4, required: 4, completed: 4, completedRequired: 4, isComplete: true, percent: 100 })
    expect(certificateGaps(done, [makePublishedMyExam()]).complete).toBe(true)
    expect(certificateGaps(done, [makePublishedMyExam(), makeOnlineMyExam()]).complete).toBe(false)
    expect(certificateGaps(done, []).complete).toBe(true)
    expect(certificateGaps(null, []).complete).toBe(false)
  })
})

describe('certificateFor', () => {
  const card = { enrollmentId: 'e-1', studentId: 'st-1', courseId: 'co-1' }
  const student = { ...makeMyCertificate().student, id: 'st-1' }
  const course = { ...makeMyCertificate().course, id: 'co-1' }

  it('prefers an issued certificate of the enrollment, then of the same course', () => {
    const other = makeMyCertificate({ id: 'c-2', enrollmentId: 'e-2', student, course })
    const own = makeMyCertificate({ id: 'c-1', enrollmentId: 'e-1', student, course })
    expect(certificateFor([other, own], card)?.id).toBe('c-1')
    expect(certificateFor([other], card)?.id).toBe('c-2')
  })

  it('returns a revoked one when none is issued, and nothing for another student or course', () => {
    const revoked = makeMyCertificate({ id: 'c-3', enrollmentId: 'e-1', status: 'revoked', revokedAt: '2026-11-23T10:00:00.000Z', student, course })
    expect(certificateFor([revoked], card)?.status).toBe('revoked')
    expect(certificateFor([makeMyCertificate({ student, enrollmentId: 'e-9' })], card)).toBeNull()
  })
})
