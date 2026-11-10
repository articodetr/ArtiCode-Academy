import { describe, expect, it } from 'vitest'
import type { ExamResultItem } from '../api/examResults'
import { RESULT_STUDENT_IDS, fourResultStudents, makeExamResult, makeResultItem } from '../test/exams'
import { changedItems, currentDraft, draftOf, draftProblem, isBatchTooLarge, isDraftChanged, isRecordableItem, planResultsSave, resultInputOf, withStatus } from './examResults.changes'
import type { ResultDraft } from './examResults.changes'

const [SARA, YOUSEF, LAYLA, OMAR] = RESULT_STUDENT_IDS
const items = fourResultStudents()
const itemOf = (id: string) => items.find((item) => item.student.id === id) as ExamResultItem
const drafts = (entries: [string, ResultDraft][]) => new Map(entries)

describe('examResults.changes (the plan of ONE PUT — API-120)', () => {
  it('records active and completed students only (not_enrolled otherwise)', () => {
    expect(items.filter(isRecordableItem).map((item) => item.student.id)).toEqual([SARA, YOUSEF, OMAR])
    expect(isRecordableItem({ enrollmentStatus: null })).toBe(false)
  })

  it('starts each row from the server’s result, or from nothing chosen', () => {
    expect(draftOf(itemOf(YOUSEF))).toEqual({ status: 'scored', score: 41.5, feedback: 'أحسنت في السؤال الثالث' })
    expect(draftOf(itemOf(SARA))).toEqual({ status: undefined, score: null, feedback: '' })
    expect(currentDraft(itemOf(SARA), drafts([[SARA, { status: 'absent', score: null, feedback: '' }]]))).toEqual({ status: 'absent', score: null, feedback: '' })
  })

  it('compares with the server at two decimals and with a trimmed feedback; a row without a result changes once a status is chosen', () => {
    const yousef = itemOf(YOUSEF)
    expect(isDraftChanged(yousef, { status: 'scored', score: 41.5, feedback: ' أحسنت في السؤال الثالث ' })).toBe(false)
    expect(isDraftChanged(yousef, { status: 'scored', score: 41.5000001, feedback: 'أحسنت في السؤال الثالث' })).toBe(false)
    expect(isDraftChanged(yousef, { status: 'scored', score: 41.75, feedback: 'أحسنت في السؤال الثالث' })).toBe(true)
    expect(isDraftChanged(yousef, { status: 'scored', score: 41.5, feedback: '' })).toBe(true)
    expect(isDraftChanged(itemOf(SARA), { status: undefined, score: null, feedback: 'ملاحظة' })).toBe(false)
    expect(isDraftChanged(itemOf(SARA), { status: 'excused', score: null, feedback: '' })).toBe(true)
  })

  it('refuses locally what the server refuses: scored without a score, a score outside 0..maxScore or with three decimals, a long feedback', () => {
    expect(draftProblem({ status: 'scored', score: null, feedback: '' }, 50)).toBe('score_required')
    expect(draftProblem({ status: 'scored', score: 50.5, feedback: '' }, 50)).toBe('score_invalid')
    expect(draftProblem({ status: 'scored', score: 12.345, feedback: '' }, 50)).toBe('score_invalid')
    expect(draftProblem({ status: 'scored', score: 50, feedback: '' }, 50)).toBeNull()
    expect(draftProblem({ status: 'absent', score: null, feedback: 'x'.repeat(501) }, 50)).toBe('feedback_too_long')
    expect(draftProblem({ status: 'excused', score: null, feedback: ` ${'x'.repeat(500)} ` }, 50)).toBeNull()
  })

  it('sends the changed recordable rows only, each as the whole new state of its result — the score with scored, a non-blank feedback', () => {
    const touched = drafts([
      [SARA, { status: 'scored', score: 47.25, feedback: ' ممتاز ' }],
      [YOUSEF, { status: 'scored', score: 41.5, feedback: 'أحسنت في السؤال الثالث' }],
      // A withdrawn student's row is read-only: never sent.
      [LAYLA, { status: 'excused', score: null, feedback: '' }],
      [OMAR, { status: 'excused', score: null, feedback: '' }],
    ])
    expect(changedItems(items, touched).map((item) => item.student.id)).toEqual([SARA, OMAR])
    expect(planResultsSave(items, touched)).toEqual({
      results: [
        { studentId: SARA, status: 'scored', score: 47.25, feedback: 'ممتاز' },
        { studentId: OMAR, status: 'excused' },
      ],
    })
    // Yousef's feedback emptied: the whole new state carries no feedback, which clears it on the server.
    expect(planResultsSave(items, drafts([[YOUSEF, { status: 'scored', score: 41.5, feedback: '  ' }]]))).toEqual({ results: [{ studentId: YOUSEF, status: 'scored', score: 41.5 }] })
    expect(planResultsSave(items, new Map())).toBeNull()
    expect(() => resultInputOf(SARA, { status: undefined, score: null, feedback: '' })).toThrow()
  })

  it('drops the score when leaving scored and keeps it otherwise; refuses batches above 500', () => {
    expect(withStatus({ status: 'scored', score: 30, feedback: 'x' }, 'absent')).toEqual({ status: 'absent', score: null, feedback: 'x' })
    expect(withStatus({ status: 'scored', score: 30, feedback: '' }, 'scored')).toEqual({ status: 'scored', score: 30, feedback: '' })
    const many = { results: Array.from({ length: 501 }, (_, index) => ({ studentId: `s-${index}`, status: 'absent' as const })) }
    expect(isBatchTooLarge(many)).toBe(true)
    expect(isBatchTooLarge({ results: many.results.slice(0, 500) })).toBe(false)
    expect(makeResultItem({ result: makeExamResult() }).result?.score).toBe(41.5)
  })
})
