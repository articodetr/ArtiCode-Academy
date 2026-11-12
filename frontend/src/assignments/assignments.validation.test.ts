import { describe, expect, it } from 'vitest'
import { isLatePenaltyValid, isMaxAttemptsValid, isMaxScoreValid, isTwoDecimalNumber, isWeightValid, latePenaltyWithoutAllowLate, missingDuePart } from './assignments.validation'

describe('assignments.validation (mirrors of CreateAssignmentDto / UpdateAssignmentDto)', () => {
  it('takes finite JSON numbers with at most two decimals', () => {
    expect(isTwoDecimalNumber(20)).toBe(true)
    expect(isTwoDecimalNumber(12.5)).toBe(true)
    expect(isTwoDecimalNumber(0.29)).toBe(true)
    expect(isTwoDecimalNumber(1.005)).toBe(false)
    expect(isTwoDecimalNumber('12')).toBe(false)
    expect(isTwoDecimalNumber(Number.NaN)).toBe(false)
    expect(isTwoDecimalNumber(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('refuses a tiny number written in exponent form — 1e-7 has more than two decimals (J-F47)', () => {
    expect(String(1e-7)).toBe('1e-7')
    expect(isTwoDecimalNumber(1e-7)).toBe(false)
    expect(isTwoDecimalNumber(0.0000001)).toBe(false)
    expect(isTwoDecimalNumber(2.5e-3)).toBe(false)
    expect(isTwoDecimalNumber(1e-2)).toBe(true)
    expect(isTwoDecimalNumber(0)).toBe(true)
    expect(isTwoDecimalNumber(-0.5)).toBe(true)
    expect(isTwoDecimalNumber(9999.99)).toBe(true)
    expect(isMaxScoreValid(1e-7)).toBe(false)
  })

  it('bounds the maximum score to 0.01..9999.99, the weight to 0..999.99 and the late penalty to 0..100', () => {
    expect(isMaxScoreValid(0.01)).toBe(true)
    expect(isMaxScoreValid(9999.99)).toBe(true)
    expect(isMaxScoreValid(0)).toBe(false)
    expect(isMaxScoreValid(10000)).toBe(false)
    expect(isMaxScoreValid(null)).toBe(false)
    expect(isWeightValid(0)).toBe(true)
    expect(isWeightValid(999.99)).toBe(true)
    expect(isWeightValid(1000)).toBe(false)
    expect(isWeightValid(-1)).toBe(false)
    expect(isWeightValid(null)).toBe(true)
    expect(isLatePenaltyValid(100)).toBe(true)
    expect(isLatePenaltyValid(100.01)).toBe(false)
    expect(isLatePenaltyValid(12.345)).toBe(false)
    expect(isLatePenaltyValid(undefined)).toBe(true)
  })

  it('takes a whole number of attempts from 1 to 20', () => {
    expect(isMaxAttemptsValid(1)).toBe(true)
    expect(isMaxAttemptsValid(20)).toBe(true)
    expect(isMaxAttemptsValid(0)).toBe(false)
    expect(isMaxAttemptsValid(21)).toBe(false)
    expect(isMaxAttemptsValid(1.5)).toBe(false)
    expect(isMaxAttemptsValid(null)).toBe(false)
  })

  it('refuses a late penalty — zero included — without late submissions (late_penalty_invalid)', () => {
    expect(latePenaltyWithoutAllowLate(false, 10)).toBe(true)
    expect(latePenaltyWithoutAllowLate(false, 0)).toBe(true)
    expect(latePenaltyWithoutAllowLate(true, 10)).toBe(false)
    expect(latePenaltyWithoutAllowLate(false, null)).toBe(false)
    expect(latePenaltyWithoutAllowLate(undefined, undefined)).toBe(false)
  })

  it('names the missing half of a due date', () => {
    expect(missingDuePart('2026-11-20', undefined)).toBe('time')
    expect(missingDuePart('', '23:59')).toBe('date')
    expect(missingDuePart('2026-11-20', '23:59')).toBeNull()
    expect(missingDuePart(undefined, '')).toBeNull()
  })
})
