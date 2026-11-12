import { describe, expect, it } from 'vitest'
import { makeGradedSubmission, makeSubmission, makeSubmissionAssignment } from '../test/submissions'
import {
  availableReviewActions,
  isReviewDraftDirty,
  isScoreInRange,
  isScoreValid,
  normalizeFeedback,
  planReview,
  returnCaveats,
  reviewDraftOf,
  reviewEffects,
  reviewTarget,
  sameReview,
  toDecimalText,
} from './submissions.status'

describe('the review mirror of submissions.policy.ts', () => {
  it('offers grade and return on any attempt to a grader only', () => {
    expect(availableReviewActions(true)).toEqual(['grade', 'return'])
    expect(availableReviewActions(false)).toEqual([])
  })

  it('writes the whole review state: grade keeps score and feedback, return clears the score', () => {
    expect(reviewTarget('grade', '17.50', 'جيد')).toEqual({ status: 'graded', score: '17.50', feedback: 'جيد' })
    expect(reviewTarget('grade', '17.50', null)).toEqual({ status: 'graded', score: '17.50', feedback: null })
    expect(reviewTarget('return', '17.50', 'أعد التمرين')).toEqual({ status: 'returned', score: null, feedback: 'أعد التمرين' })
    expect(sameReview({ status: 'graded', score: '17.50', feedback: null }, { status: 'graded', score: '17.50', feedback: null })).toBe(true)
    expect(sameReview({ status: 'graded', score: '17.50', feedback: null }, { status: 'graded', score: '18.00', feedback: null })).toBe(false)
  })

  it('compares scores as two-decimal text and feedback trimmed with a blank as absent', () => {
    expect(toDecimalText(17.5)).toBe('17.50')
    expect(toDecimalText(20)).toBe('20.00')
    expect(toDecimalText(null)).toBeNull()
    expect(normalizeFeedback('  جيد  ')).toBe('جيد')
    expect(normalizeFeedback('   ')).toBeNull()
    expect(normalizeFeedback(undefined)).toBeNull()
  })

  it('accepts a score from 0 to the max score with at most two decimals', () => {
    expect(isScoreInRange(0, 20)).toBe(true)
    expect(isScoreInRange(20, 20)).toBe(true)
    expect(isScoreInRange(20.01, 20)).toBe(false)
    expect(isScoreInRange(-0.5, 20)).toBe(false)
    expect(isScoreValid(17.25, 20)).toBe(true)
    expect(isScoreValid(17.255, 20)).toBe(false)
    expect(isScoreValid(null, 20)).toBe(false)
    expect(isScoreValid(Number.NaN, 20)).toBe(false)
  })
})

describe('planReview', () => {
  const waiting = makeSubmission()
  const graded = makeGradedSubmission()

  it('grades with the smallest body: the score alone, plus the feedback only when it is not blank — and null as the review seen on a waiting attempt', () => {
    expect(planReview(waiting, { action: 'grade', score: 17.5, feedback: '   ' })).toEqual({ kind: 'send', body: { action: 'grade', score: 17.5, expectedGradedAt: null } })
    expect(planReview(waiting, { action: 'grade', score: 17.5, feedback: ' عمل جيد ' })).toEqual({
      kind: 'send',
      body: { action: 'grade', score: 17.5, feedback: 'عمل جيد', expectedGradedAt: null },
    })
  })

  it('returns with the feedback and never a score, naming the review it replaces (D-R49)', () => {
    expect(planReview(graded, { action: 'return', score: 17.5, feedback: 'أكمل التمرين الثالث' })).toEqual({
      kind: 'send',
      body: { action: 'return', feedback: 'أكمل التمرين الثالث', expectedGradedAt: '2026-11-21T09:00:00.000Z' },
    })
  })

  it('sends the gradedAt the grader saw with every review: a correction of a graded attempt names its review', () => {
    const plan = planReview(graded, { action: 'grade', score: 18, feedback: 'عمل جيد؛ راجع شرط التوقف' })
    expect(plan).toEqual({ kind: 'send', body: { action: 'grade', score: 18, feedback: 'عمل جيد؛ راجع شرط التوقف', expectedGradedAt: graded.gradedAt } })
    const returned = makeSubmission({ status: 'returned', feedback: 'أعد', gradedAt: '2026-11-20T08:00:00.000Z' })
    expect(planReview(returned, { action: 'grade', score: 12 })).toEqual({ kind: 'send', body: { action: 'grade', score: 12, expectedGradedAt: '2026-11-20T08:00:00.000Z' } })
  })

  it('refuses in the server order: return without feedback, then a score out of range or with three decimals', () => {
    expect(planReview(waiting, { action: 'return', feedback: '  ' })).toEqual({ kind: 'invalid', field: 'feedback' })
    expect(planReview(waiting, { action: 'grade', score: 20.5 })).toEqual({ kind: 'invalid', field: 'score' })
    expect(planReview(waiting, { action: 'grade', score: -1 })).toEqual({ kind: 'invalid', field: 'score' })
    expect(planReview(waiting, { action: 'grade', score: 10.125 })).toEqual({ kind: 'invalid', field: 'score' })
    expect(planReview(waiting, { action: 'grade' })).toEqual({ kind: 'invalid', field: 'score' })
  })

  it('sends nothing for a review equal to the stored one, and a correction when one part differs', () => {
    expect(planReview(graded, { action: 'grade', score: 17.5, feedback: 'عمل جيد؛ راجع شرط التوقف ' })).toEqual({ kind: 'unchanged' })
    // A blank feedback with grade clears the stored one: that is a change.
    expect(planReview(graded, { action: 'grade', score: 17.5, feedback: '' })).toEqual({ kind: 'send', body: { action: 'grade', score: 17.5, expectedGradedAt: graded.gradedAt } })
    const returned = makeSubmission({ status: 'returned', feedback: 'أكمل التمرين الثالث', gradedAt: '2026-11-20T08:00:00.000Z' })
    expect(planReview(returned, { action: 'return', feedback: 'أكمل التمرين الثالث' })).toEqual({ kind: 'unchanged' })
  })
})

describe('the grading form', () => {
  it('starts from the stored review so an untouched form is not dirty', () => {
    expect(reviewDraftOf(makeSubmission())).toEqual({ action: 'grade', score: null, feedback: '' })
    expect(reviewDraftOf(makeGradedSubmission())).toEqual({ action: 'grade', score: 17.5, feedback: 'عمل جيد؛ راجع شرط التوقف' })
    expect(reviewDraftOf(makeSubmission({ status: 'returned', feedback: 'أعد' }))).toEqual({ action: 'return', score: null, feedback: 'أعد' })
  })

  it('is dirty with a typed feedback, another score or another action — not with surrounding spaces', () => {
    const initial = reviewDraftOf(makeGradedSubmission())
    expect(isReviewDraftDirty(initial, { ...initial })).toBe(false)
    expect(isReviewDraftDirty(initial, { ...initial, feedback: ' عمل جيد؛ راجع شرط التوقف ' })).toBe(false)
    expect(isReviewDraftDirty(initial, { ...initial, feedback: 'نص آخر' })).toBe(true)
    expect(isReviewDraftDirty(initial, { ...initial, score: 18 })).toBe(true)
    expect(isReviewDraftDirty(initial, { ...initial, action: 'return' })).toBe(true)
    expect(isReviewDraftDirty(reviewDraftOf(makeSubmission()), { action: 'grade', score: undefined, feedback: 'ملاحظة' })).toBe(true)
  })

  it('reads the score the store keeps while «return» hides its field: back on «grade» it counts again', () => {
    // A waiting attempt: 15 typed, then return, then grade — the whole store still holds 15.
    expect(isReviewDraftDirty(reviewDraftOf(makeSubmission()), { action: 'grade', score: 15, feedback: '' })).toBe(true)
    // A graded 17.5: grade → return → grade with nothing changed is the stored review.
    const graded = reviewDraftOf(makeGradedSubmission())
    expect(isReviewDraftDirty(graded, { action: 'grade', score: 17.5, feedback: 'عمل جيد؛ راجع شرط التوقف' })).toBe(false)
  })
})

describe('the effects the panel announces (D-R39)', () => {
  it('a return grants one attempt (not twice) and clears a grade; grading a returned attempt takes it back', () => {
    expect(reviewEffects('submitted', 'return')).toEqual({ grantsAttempt: true, clearsScore: false, withdrawsAttempt: false })
    expect(reviewEffects('graded', 'return')).toEqual({ grantsAttempt: true, clearsScore: true, withdrawsAttempt: false })
    expect(reviewEffects('returned', 'return')).toEqual({ grantsAttempt: false, clearsScore: false, withdrawsAttempt: false })
    expect(reviewEffects('returned', 'grade')).toEqual({ grantsAttempt: false, clearsScore: false, withdrawsAttempt: true })
    expect(reviewEffects('submitted', 'grade')).toEqual({ grantsAttempt: false, clearsScore: false, withdrawsAttempt: false })
  })

  it('warns that a granted attempt waits for a closed assignment to reopen, or for a due date without late submissions — never from the clock', () => {
    expect(returnCaveats(makeSubmissionAssignment({ allowLate: true }))).toEqual([])
    expect(returnCaveats(makeSubmissionAssignment({ status: 'closed', allowLate: true }))).toEqual(['closed'])
    expect(returnCaveats(makeSubmissionAssignment({ allowLate: false }))).toEqual(['noLate'])
    expect(returnCaveats(makeSubmissionAssignment({ status: 'closed', allowLate: false }))).toEqual(['closed', 'noLate'])
    expect(returnCaveats(makeSubmissionAssignment({ dueAt: null, allowLate: false }))).toEqual([])
  })
})
