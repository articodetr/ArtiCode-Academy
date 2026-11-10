import { describe, expect, it } from 'vitest'
import { EXAM_RESULT_STATUSES } from '../api/examResults'
import { makeExam } from '../test/exams'
import { RESULT_STATUS_COLORS, examTitle, resultsRatio } from './exams.format'

describe('exams.format', () => {
  it('shows the title in the active language with the Arabic one as the fallback', () => {
    expect(examTitle(makeExam(), 'ar')).toBe('اختبار منتصف الفصل')
    expect(examTitle(makeExam(), 'en')).toBe('Midterm exam')
    expect(examTitle(makeExam({ title: { ar: 'قصير' } }), 'en')).toBe('قصير')
  })

  it('reads «recorded / total» from the server’s counts and gives every result status a colour', () => {
    expect(resultsRatio(makeExam({ results: { students: 14, scored: 12, absent: 1, excused: 1 }, activeStudents: 18 }))).toBe('14 / 18')
    expect(EXAM_RESULT_STATUSES.map((status) => RESULT_STATUS_COLORS[status])).toEqual(['green', 'red', 'blue'])
  })
})
