import { describe, expect, it } from 'vitest'
import { CLASS_STATUSES } from '../api/classes'
import { ENROLLMENT_STATUSES } from '../api/enrollments'
import { STUDENT_IDS, makeEnrollment, makeStudentCandidate } from '../test/enrollments'
import {
  availableEnrollmentActions,
  enrolledCountDelta,
  hasFreeSeat,
  isDangerousEnrollmentAction,
  isEnrollableClass,
  matchesRosterSearch,
  nextEnrollmentStatus,
  studentRefusal,
  takesSeat,
} from './enrollments.status'

describe('enrollments.status (mirror of backend/src/enrollments/enrollments.status.ts)', () => {
  it('follows the documented transitions', () => {
    expect(nextEnrollmentStatus('withdraw', 'active')).toBe('withdrawn')
    expect(nextEnrollmentStatus('complete', 'active')).toBe('completed')
    expect(nextEnrollmentStatus('cancel', 'active')).toBe('cancelled')
    expect(nextEnrollmentStatus('reactivate', 'withdrawn')).toBe('active')
    expect(nextEnrollmentStatus('reactivate', 'cancelled')).toBe('active')
    expect(nextEnrollmentStatus('reactivate', 'active')).toBeNull()
    expect(nextEnrollmentStatus('withdraw', 'completed')).toBeNull()
    expect(nextEnrollmentStatus('cancel', 'pending')).toBeNull()
  })

  it('offers the allowed actions per status for enrollments.manage, nothing without it', () => {
    const offered = Object.fromEntries(ENROLLMENT_STATUSES.map((status) => [status, availableEnrollmentActions(status, true)]))
    expect(offered).toEqual({
      pending: [],
      active: ['withdraw', 'complete', 'cancel'],
      completed: [],
      withdrawn: ['reactivate'],
      cancelled: ['reactivate'],
    })
    for (const status of ENROLLMENT_STATUSES) expect(availableEnrollmentActions(status, false)).toEqual([])
    expect(isDangerousEnrollmentAction('withdraw')).toBe(true)
    expect(isDangerousEnrollmentAction('cancel')).toBe(true)
    expect(isDangerousEnrollmentAction('complete')).toBe(false)
    expect(isDangerousEnrollmentAction('reactivate')).toBe(false)
    expect(takesSeat('reactivate')).toBe(true)
    expect(takesSeat('withdraw')).toBe(false)
  })

  it('enrolls into open or running classes only, while a seat is free', () => {
    expect(CLASS_STATUSES.filter(isEnrollableClass)).toEqual(['open', 'running'])
    expect(hasFreeSeat(20, 19)).toBe(true)
    expect(hasFreeSeat(20, 20)).toBe(false)
    expect(hasFreeSeat(0, 0)).toBe(false)
  })

  it('moves the active count by +1 into active, −1 out of active, 0 otherwise', () => {
    expect(enrolledCountDelta(null, 'active')).toBe(1)
    expect(enrolledCountDelta('active', 'withdrawn')).toBe(-1)
    expect(enrolledCountDelta('active', 'completed')).toBe(-1)
    expect(enrolledCountDelta('active', 'cancelled')).toBe(-1)
    expect(enrolledCountDelta('withdrawn', 'active')).toBe(1)
    expect(enrolledCountDelta('cancelled', 'active')).toBe(1)
    expect(enrolledCountDelta('active', 'active')).toBe(0)
    expect(enrolledCountDelta('withdrawn', 'withdrawn')).toBe(0)
  })

  it('refuses locally a student already on the loaded roster, a non-student and an ineligible or deleted account', () => {
    const roster = [makeEnrollment({ status: 'withdrawn' })]
    expect(studentRefusal(makeStudentCandidate({ id: STUDENT_IDS[0] }), roster)).toBe('already_enrolled')
    expect(studentRefusal(makeStudentCandidate({ roles: ['guardian'] }), roster)).toBe('not_a_student')
    expect(studentRefusal(makeStudentCandidate({ status: 'suspended' }), roster)).toBe('not_eligible')
    expect(studentRefusal(makeStudentCandidate({ deletedAt: '2026-11-01T00:00:00.000Z' }), roster)).toBe('not_eligible')
    expect(studentRefusal(makeStudentCandidate({ status: 'invited' }), roster)).toBeNull()
    expect(studentRefusal(makeStudentCandidate(), [])).toBeNull()
  })

  it('matches the local roster search against the visible names and identifiers, case-insensitively', () => {
    const row = makeEnrollment()
    expect(matchesRosterSearch(row, '')).toBe(true)
    expect(matchesRosterSearch(row, '  ')).toBe(true)
    expect(matchesRosterSearch(row, 'عمر')).toBe(true)
    expect(matchesRosterSearch(row, 'OMAR')).toBe(true)
    expect(matchesRosterSearch(row, 'omar@test')).toBe(true)
    expect(matchesRosterSearch(row, 'ليلى')).toBe(false)
    // The reduced projection has no contact fields to match.
    expect(matchesRosterSearch(makeEnrollment({ student: { ...row.student, email: null, username: null } }), 'omar@test')).toBe(false)
  })
})
