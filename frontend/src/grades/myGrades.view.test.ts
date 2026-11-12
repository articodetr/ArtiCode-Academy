import { describe, expect, it } from 'vitest'
import { makeFinalGrade, makeGradeComponent, sixComponents } from '../test/myGrades'
import {
  DEFAULT_MY_GRADES_FILTERS,
  bandText,
  hiddenRelations,
  isNarrowed,
  isWeighted,
  myGradesQuery,
  percentText,
  scoreCellOf,
  scoreFromEarlierAttempt,
  statusKeyOf,
} from './myGrades.view'

describe('myGradesQuery (API-129 parameters — no pagination)', () => {
  it('sends the class and the student only, and counts either as narrowing', () => {
    expect(myGradesQuery(DEFAULT_MY_GRADES_FILTERS)).toEqual({ classId: undefined, studentId: undefined })
    expect(myGradesQuery({ classId: 'c-1', studentId: 's-1' })).toEqual({ classId: 'c-1', studentId: 's-1' })
    expect(isNarrowed(DEFAULT_MY_GRADES_FILTERS)).toBe(false)
    expect(isNarrowed({ classId: 'c-1', studentId: undefined })).toBe(true)
    expect(isNarrowed({ classId: undefined, studentId: 's-1' })).toBe(true)
  })
})

describe('hiddenRelations (one grades key shows its relation only — D-R48)', () => {
  it('hides nothing from the seeded student and guardian, and nothing when the server refuses the whole page', () => {
    expect(hiddenRelations(['student'], ['grades.read_own'])).toEqual([])
    expect(hiddenRelations(['guardian'], ['grades.read_linked'])).toEqual([])
    expect(hiddenRelations(['student', 'guardian'], ['grades.read_own', 'grades.read_linked'])).toEqual([])
    // Neither key: 403 permission_denied — the page words that instead.
    expect(hiddenRelations(['student', 'guardian'], ['exams.read'])).toEqual([])
  })

  it('names the relation a missing key hides, only for the role key that owns it', () => {
    expect(hiddenRelations(['student', 'guardian'], ['grades.read_linked'])).toEqual(['self'])
    expect(hiddenRelations(['student', 'guardian'], ['grades.read_own'])).toEqual(['child'])
    // A student without the guardian role key owns no child's enrollment: nothing is hidden from them.
    expect(hiddenRelations(['student'], ['grades.read_own', 'exams.read'])).toEqual([])
    expect(hiddenRelations(['teacher', 'guardian'], ['grades.read_own'])).toEqual(['child'])
  })
})

describe('a component as the server sent it', () => {
  it('counts a weight above 0 only (null or 0 = informational — D-R43)', () => {
    expect(isWeighted(makeGradeComponent({ weight: 10 }))).toBe(true)
    expect(isWeighted(makeGradeComponent({ weight: 0.5 }))).toBe(true)
    expect(isWeighted(makeGradeComponent({ weight: 0 }))).toBe(false)
    expect(isWeighted(makeGradeComponent({ weight: null }))).toBe(false)
  })

  it('words «missing» per kind and keeps every other state', () => {
    const [late, awaiting, missing, scored, absent, excused] = sixComponents()
    expect([late, awaiting, missing, scored, absent, excused].map((component) => statusKeyOf(component!))).toEqual([
      'graded',
      'awaiting_review',
      'missing_assignment',
      'scored',
      'absent',
      'excused',
    ])
    expect(statusKeyOf(makeGradeComponent({ kind: 'exam', status: 'missing' }))).toBe('missing_exam')
  })

  it('shows the server’s score, its score after the late penalty only when that differs, an absence’s 0, and nothing else', () => {
    const [late, awaiting, missing, scored, absent, excused] = sixComponents()
    expect(scoreCellOf(late!)).toEqual({ kind: 'score', score: 18, adjusted: 16.2 })
    expect(scoreCellOf(scored!)).toEqual({ kind: 'score', score: 41.5, adjusted: null })
    // Late without a penalty: the server's effective score is the score — nothing to add.
    expect(scoreCellOf(makeGradeComponent({ late: true, score: 18, effectiveScore: 18 }))).toEqual({ kind: 'score', score: 18, adjusted: null })
    // An on-time attempt never shows an adjusted score, whatever the effective score says.
    expect(scoreCellOf(makeGradeComponent({ late: false, score: 18, effectiveScore: 16.2 }))).toEqual({ kind: 'score', score: 18, adjusted: null })
    expect(scoreCellOf(absent!)).toEqual({ kind: 'counted', value: 0 })
    for (const component of [awaiting!, missing!, excused!]) expect(scoreCellOf(component)).toEqual({ kind: 'none' })
  })

  it('says when the score comes from an earlier graded attempt while a newer one waits for review', () => {
    expect(scoreFromEarlierAttempt(makeGradeComponent({ status: 'awaiting_review', score: 15, effectiveScore: 15 }))).toBe(true)
    expect(scoreFromEarlierAttempt(makeGradeComponent({ status: 'awaiting_review', score: null, effectiveScore: null }))).toBe(false)
    expect(scoreFromEarlierAttempt(makeGradeComponent())).toBe(false)
    expect(scoreFromEarlierAttempt(makeGradeComponent({ kind: 'exam', status: 'scored' }))).toBe(false)
  })
})

describe('the final grade as the server fixed it', () => {
  it('prints the percentage as it came and the band with its letter in the active language', () => {
    expect(percentText(86.4)).toBe('86.4%')
    expect(percentText(100)).toBe('100%')
    expect(bandText(makeFinalGrade(), 'ar')).toBe('جيد جداً (B)')
    expect(bandText(makeFinalGrade(), 'en')).toBe('Very good (B)')
    expect(bandText(makeFinalGrade({ letter: null }), 'ar')).toBe('جيد جداً')
    // English missing: the mandatory Arabic.
    expect(bandText(makeFinalGrade({ label: { ar: 'ممتاز' }, letter: 'A' }), 'en')).toBe('ممتاز (A)')
    expect(bandText(makeFinalGrade({ label: { ar: '' }, letter: 'A' }), 'ar')).toBe('A')
  })
})
