import { describe, expect, it } from 'vitest'
import { isCalendarDate, isValidRoleKey, isValidUsername } from './users.validation'

describe('isCalendarDate', () => {
  it('accepts real calendar days only', () => {
    expect(isCalendarDate('2012-05-01')).toBe(true)
    expect(isCalendarDate('2024-02-29')).toBe(true)
    expect(isCalendarDate('2026-02-30')).toBe(false)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('1/5/2012')).toBe(false)
    expect(isCalendarDate('')).toBe(false)
  })
})

describe('identifier patterns', () => {
  it('validates the username after the server normalisation (trim + lower-case)', () => {
    expect(isValidUsername(' Sara.Ahmed ')).toBe(true)
    expect(isValidUsername('ab')).toBe(false)
    expect(isValidUsername('.sara')).toBe(false)
    expect(isValidUsername('sara ahmed')).toBe(false)
  })

  it('validates role keys', () => {
    expect(isValidRoleKey('academy_admin')).toBe(true)
    expect(isValidRoleKey('Exam_Supervisor')).toBe(true)
    expect(isValidRoleKey('1admin')).toBe(false)
    expect(isValidRoleKey('ad')).toBe(false)
    expect(isValidRoleKey('exam-supervisor')).toBe(false)
  })
})
