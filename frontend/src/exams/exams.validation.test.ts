import { describe, expect, it } from 'vitest'
import { isDurationValid, isExamMaxScoreValid, isExamWeightValid, isPassScoreValid, isResultScoreValid, missingSchedulePart, passScoreAboveMax } from './exams.validation'

describe('exams.validation (mirrors of CreateExamDto / UpdateExamDto and the result score)', () => {
  it('accepts a maximum score of 0.01..9999.99 with at most two decimals', () => {
    expect([0.01, 50, 9999.99, 12.5].every(isExamMaxScoreValid)).toBe(true)
    expect([0, -1, 10000, 12.345, Number.NaN, '50', null].some(isExamMaxScoreValid)).toBe(false)
  })

  it('accepts an optional pass score of 0..9999.99 and refuses one above the maximum score', () => {
    expect([null, undefined, 0, 25, 9999.99].every(isPassScoreValid)).toBe(true)
    expect([-0.5, 25.555, '25'].some(isPassScoreValid)).toBe(false)
    expect(passScoreAboveMax(30, 25)).toBe(true)
    expect(passScoreAboveMax(25, 25)).toBe(false)
    expect(passScoreAboveMax(null, 25)).toBe(false)
    expect(passScoreAboveMax(30, null)).toBe(false)
  })

  it('accepts an optional weight of 0..999.99 and an optional whole duration of 1..720 minutes', () => {
    expect([null, 0, 30, 999.99].every(isExamWeightValid)).toBe(true)
    expect([1000, -1, 1.234].some(isExamWeightValid)).toBe(false)
    expect([null, undefined, 1, 60, 720].every(isDurationValid)).toBe(true)
    expect([0, 721, 45.5, '60'].some(isDurationValid)).toBe(false)
  })

  it('accepts a result score of 0..maxScore with at most two decimals (score_out_of_range)', () => {
    expect([0, 41.5, 50, 49.99].every((score) => isResultScoreValid(score, 50))).toBe(true)
    expect([-1, 50.01, 41.555, Number.NaN].some((score) => isResultScoreValid(score, 50))).toBe(false)
  })

  it('names the missing half of the exam date', () => {
    expect(missingSchedulePart('2026-11-20', undefined)).toBe('time')
    expect(missingSchedulePart(undefined, '10:00')).toBe('date')
    expect(missingSchedulePart('2026-11-20', '10:00')).toBeNull()
    expect(missingSchedulePart('', '')).toBeNull()
  })
})
