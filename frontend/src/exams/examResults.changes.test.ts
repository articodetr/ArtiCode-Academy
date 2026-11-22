import { describe, expect, it } from 'vitest'
import type { ExamResultItem } from '../api/examResults'
import { HIND_ID, fiveOnlineResultStudents } from '../test/examAttempts'
import { RESULT_STUDENT_IDS, fourResultStudents, makeExamResult, makeResultItem } from '../test/exams'
import {
  changedItems,
  currentDraft,
  draftOf,
  draftProblem,
  hasAttempt,
  isBatchTooLarge,
  isDraftChanged,
  isEditableItem,
  isRecordableItem,
  planResultsSave,
  resultInputOf,
  withStatus,
  withoutDrafts,
} from './examResults.changes'
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

describe('examResults.changes for an online exam (D-R160 — a student with an attempt is never recorded on the sheet)', () => {
  const online = fiveOnlineResultStudents()
  const idsOf = (rows: ExamResultItem[]) => rows.map((item) => item.student.id)

  it('locks the row of a student who has an attempt, whatever its state, and leaves those without one to the sheet', () => {
    // سارة (two attempts, a counted result), يوسف (an attempt in progress, no result yet), ليلى (one attempt, withdrawn).
    expect(online.map(hasAttempt)).toEqual([true, true, true, false, false])
    expect(idsOf(online.filter(isEditableItem))).toEqual([OMAR, HIND_ID])
    expect(isEditableItem({ enrollmentStatus: 'active', attemptCount: 1 })).toBe(false)
    expect(isEditableItem({ enrollmentStatus: 'completed', attemptCount: 0 })).toBe(true)
    // No attempt does not open a row the enrollment closes.
    expect(isEditableItem({ enrollmentStatus: 'withdrawn', attemptCount: 0 })).toBe(false)
    expect(isEditableItem({ enrollmentStatus: null, attemptCount: 0 })).toBe(false)
  })

  it('never plans a row with an attempt, whatever draft it holds — only the rows without one go in the PUT', () => {
    const touched = drafts([
      [SARA, { status: 'absent', score: null, feedback: '' }],
      [YOUSEF, { status: 'scored', score: 9, feedback: 'ورقي' }],
      [LAYLA, { status: 'excused', score: null, feedback: '' }],
      [OMAR, { status: 'excused', score: null, feedback: '' }],
      [HIND_ID, { status: 'scored', score: 7.5, feedback: ' أدّت الاختبار ورقياً ' }],
    ])
    expect(idsOf(changedItems(online, touched))).toEqual([OMAR, HIND_ID])
    expect(planResultsSave(online, touched)).toEqual({
      results: [
        { studentId: OMAR, status: 'excused' },
        { studentId: HIND_ID, status: 'scored', score: 7.5, feedback: 'أدّت الاختبار ورقياً' },
      ],
    })
    // Drafts on locked rows only: nothing to save, nothing unsaved.
    expect(
      planResultsSave(
        online,
        drafts([
          [SARA, { status: 'absent', score: null, feedback: '' }],
          [YOUSEF, { status: 'absent', score: null, feedback: '' }],
        ]),
      ),
    ).toBeNull()
  })

  it('plans a manual sheet exactly as before: no row of it has an attempt', () => {
    expect(items.some(hasAttempt)).toBe(false)
    expect(idsOf(items.filter(isEditableItem))).toEqual(idsOf(items.filter(isRecordableItem)))
  })

  it('drops the drafts of the students the server refused for good and keeps the others, without touching the map it was given', () => {
    const touched = drafts([
      [OMAR, { status: 'excused', score: null, feedback: '' }],
      [HIND_ID, { status: 'absent', score: null, feedback: '' }],
    ])
    const kept = withoutDrafts(touched, [HIND_ID, 'not-on-the-sheet'])
    expect([...kept.keys()]).toEqual([OMAR])
    expect([...touched.keys()]).toEqual([OMAR, HIND_ID])
    expect(withoutDrafts(touched, []).size).toBe(2)
  })
})
