import { describe, expect, it } from 'vitest'
import { isRole, primaryRole } from './roles'

describe('primaryRole', () => {
  it('maps each system role key to its UI role', () => {
    expect(primaryRole(['academy_admin'])).toBe('admin')
    expect(primaryRole(['staff'])).toBe('staff')
    expect(primaryRole(['teacher'])).toBe('teacher')
    expect(primaryRole(['guardian'])).toBe('guardian')
    expect(primaryRole(['student'])).toBe('student')
  })

  it('prefers the widest view when several roles are held', () => {
    expect(primaryRole(['student', 'teacher'])).toBe('teacher')
    expect(primaryRole(['teacher', 'staff', 'student'])).toBe('staff')
    expect(primaryRole(['guardian', 'academy_admin'])).toBe('admin')
    expect(primaryRole(['student', 'guardian'])).toBe('guardian')
  })

  it('ignores unknown (custom) role keys and returns null when none is known', () => {
    expect(primaryRole([])).toBeNull()
    expect(primaryRole(['custom_reporting'])).toBeNull()
    expect(primaryRole(['custom_reporting', 'student'])).toBe('student')
  })
})

describe('isRole', () => {
  it('accepts only the five academy roles', () => {
    expect(isRole('admin')).toBe(true)
    expect(isRole('guardian')).toBe(true)
    expect(isRole('academy_admin')).toBe(false)
    expect(isRole('super_admin')).toBe(false)
    expect(isRole(null)).toBe(false)
    expect(isRole(42)).toBe(false)
  })
})
