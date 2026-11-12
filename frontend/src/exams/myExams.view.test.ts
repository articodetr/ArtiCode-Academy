import { describe, expect, it } from 'vitest'
import { makeMyExam, makeMyExamResult, makePublishedMyExam } from '../test/myExams'
import { CHILD_ONE, SELF_STUDENT } from '../test/myLessons'
import { defaultMyExamsFilters, isNarrowed, myExamKey, myExamsQuery, resultCellOf } from './myExams.view'
import type { MyExamsFilters } from './myExams.view'

const ZONE = 'Asia/Riyadh'
const filters = (patch: Partial<MyExamsFilters> = {}): MyExamsFilters => ({ ...defaultMyExamsFilters(ZONE), ...patch })

describe('myExamsQuery (API-121 parameters of the filters)', () => {
  it('opens on every scheduled and published exam by date, earliest first, 20 per page — no default range', () => {
    expect(myExamsQuery(filters())).toEqual({ classId: undefined, studentId: undefined, status: undefined, from: undefined, to: undefined, order: 'asc', limit: 20 })
  })

  it('turns the two days into the first and last instants of those days in the filter zone (both inclusive)', () => {
    const query = myExamsQuery(filters({ from: '2026-11-01', to: '2026-11-30' }))
    // Asia/Riyadh is UTC+3 all year.
    expect(query.from).toBe('2026-10-31T21:00:00.000Z')
    expect(query.to).toBe('2026-11-30T20:59:59.999Z')
    expect(myExamsQuery(filters({ from: '2026-11-01', timeZone: 'UTC' })).from).toBe('2026-11-01T00:00:00.000Z')
    expect(myExamsQuery(filters({ from: 'not-a-day' })).from).toBeUndefined()
  })

  it('passes the student, the class, the status, the order and the page size through', () => {
    expect(myExamsQuery(filters({ studentId: 's-1', classId: 'c-1', status: 'published', order: 'desc', limit: 50 }))).toEqual({
      classId: 'c-1',
      studentId: 's-1',
      status: 'published',
      from: undefined,
      to: undefined,
      order: 'desc',
      limit: 50,
    })
  })

  it('counts the student, the class, the status and the days as narrowing — never the order, the page size or the zone', () => {
    expect(isNarrowed(filters())).toBe(false)
    expect(isNarrowed(filters({ order: 'desc', limit: 100, timeZone: 'UTC' }))).toBe(false)
    expect(isNarrowed(filters({ studentId: 's-1' }))).toBe(true)
    expect(isNarrowed(filters({ classId: 'c-1' }))).toBe(true)
    expect(isNarrowed(filters({ status: 'scheduled' }))).toBe(true)
    expect(isNarrowed(filters({ to: '2026-11-30' }))).toBe(true)
  })

  it('keys a row by exam and student: a guardian with two children in one class gets two rows of one exam', () => {
    const self = makeMyExam()
    const child = makeMyExam({ relation: 'child', student: CHILD_ONE })
    expect(myExamKey(self)).not.toBe(myExamKey(child))
    expect(myExamKey(self)).toBe(`${self.id}:${SELF_STUDENT.id}`)
  })
})

describe('resultCellOf (the student’s own result, once the server sends it — D-R47)', () => {
  it('waits for the publication of a scheduled exam, and says «no result» for a published exam without one', () => {
    expect(resultCellOf(makeMyExam())).toEqual({ kind: 'awaiting' })
    expect(resultCellOf(makePublishedMyExam({ result: null }))).toEqual({ kind: 'none' })
  })

  it('shows the result as the server sent it — the score with `scored` only', () => {
    expect(resultCellOf(makePublishedMyExam())).toEqual({ kind: 'result', status: 'scored', score: 41.5 })
    expect(resultCellOf(makePublishedMyExam({ result: makeMyExamResult({ status: 'absent', score: null }) }))).toEqual({ kind: 'result', status: 'absent', score: null })
    expect(resultCellOf(makePublishedMyExam({ result: makeMyExamResult({ status: 'excused', score: null, feedback: null }) }))).toEqual({ kind: 'result', status: 'excused', score: null })
  })
})
