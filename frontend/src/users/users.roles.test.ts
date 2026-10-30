import { describe, expect, it } from 'vitest'
import { ADMIN_PERMISSIONS, LIMITED_ASSIGNER_PERMISSIONS, makeUserDetail, ROLE_OPTIONS } from '../test/users'
import {
  diffRoleKeys,
  employeeKindRequired,
  normaliseRoleKeys,
  outOfReachHeldRoles,
  planRolesReplacement,
  removesOwnAdmin,
  roleOptionsFor,
} from './users.roles'

const student = makeUserDetail()
const guardianOnly = makeUserDetail({ roles: [{ key: 'guardian', label: { ar: 'ولي أمر' } }], studentProfile: null, employeeProfile: null })

describe('role diff and plan (mirror of API-034)', () => {
  it('normalises the keys and computes the sorted diff', () => {
    expect(normaliseRoleKeys([' Teacher', 'student', 'teacher', ''])).toEqual(['student', 'teacher'])
    expect(diffRoleKeys(['student'], ['teacher', 'student', 'guardian'])).toEqual({ added: ['guardian', 'teacher'], removed: [] })
    expect(diffRoleKeys(['academy_admin', 'teacher'], ['teacher'])).toEqual({ added: [], removed: ['academy_admin'] })
  })

  it('sends the full set only when it differs, with employeeKind only when both employee roles are added to a user without a profile', () => {
    expect(planRolesReplacement(student, ['student'])).toBeNull()
    expect(planRolesReplacement(student, ['student', 'teacher'])).toEqual({ roleKeys: ['student', 'teacher'] })
    // One employee role: the server infers the kind — an explicit value would be a profile_mismatch, so it is dropped.
    expect(planRolesReplacement(guardianOnly, ['guardian', 'teacher'], 'teacher')).toEqual({ roleKeys: ['guardian', 'teacher'] })
    expect(planRolesReplacement(guardianOnly, ['guardian', 'teacher', 'staff'], 'staff')).toEqual({ roleKeys: ['guardian', 'staff', 'teacher'], employeeKind: 'staff' })
    expect(employeeKindRequired(guardianOnly, ['staff', 'teacher'])).toBe(true)
    expect(employeeKindRequired({ employeeProfile: { employeeNumber: null, kind: 'teacher', jobTitle: null, specialization: null, hiredOn: null, isActive: true } }, ['staff', 'teacher'])).toBe(false)
    expect(planRolesReplacement(guardianOnly, [])).toEqual({ roleKeys: [] })
  })

  it('detects when the signed-in user takes academy_admin away from themself', () => {
    const me = makeUserDetail({ roles: [{ key: 'academy_admin', label: { ar: 'مدير' } }, { key: 'teacher', label: { ar: 'معلم' } }] })
    expect(removesOwnAdmin(me, me.id, ['teacher'])).toBe(true)
    expect(removesOwnAdmin(me, me.id, ['academy_admin'])).toBe(false)
    expect(removesOwnAdmin(me, 'someone-else', ['teacher'])).toBe(false)
    expect(removesOwnAdmin(me, null, [])).toBe(false)
  })
})

describe('reach rules (SEC-R-16 / SEC-R-17)', () => {
  it('locks the roles the caller could not grant and the admin role on oneself', () => {
    const admin = roleOptionsFor(ROLE_OPTIONS, student, { permissions: ADMIN_PERMISSIONS, selfId: 'me', language: 'ar' })
    expect(admin.map((option) => [option.value, option.lock])).toEqual([
      ['academy_admin', null],
      ['staff', null],
      ['teacher', null],
      ['guardian', null],
      ['student', null],
      ['librarian', null],
    ])
    expect(admin[0].label).toBe('مدير الأكاديمية')
    expect(roleOptionsFor(ROLE_OPTIONS, student, { permissions: ADMIN_PERMISSIONS, selfId: 'me', language: 'en' })[0].label).toBe('Academy Admin')

    const limited = roleOptionsFor(ROLE_OPTIONS, student, { permissions: LIMITED_ASSIGNER_PERMISSIONS, selfId: 'me', language: 'ar' })
    expect(limited.filter((option) => option.lock === 'unreachable').map((option) => option.value)).toEqual(['academy_admin', 'staff'])
    // Learner roles carry baseline keys only; `teacher` needs `users.read`, which every assigner holds.
    expect(limited.filter((option) => option.lock === null).map((option) => option.value)).toEqual(['teacher', 'guardian', 'student', 'librarian'])

    const me = makeUserDetail({ roles: [{ key: 'academy_admin', label: { ar: 'مدير' } }] })
    const own = roleOptionsFor(ROLE_OPTIONS, me, { permissions: ADMIN_PERMISSIONS, selfId: me.id, language: 'ar' })
    expect(own.find((option) => option.value === 'academy_admin')?.lock).toBe('self_admin')
    expect(roleOptionsFor(ROLE_OPTIONS, me, { permissions: ADMIN_PERMISSIONS, selfId: 'other', language: 'ar' }).find((option) => option.value === 'academy_admin')?.lock).toBeNull()
  })

  it('names the held roles out of the caller’s reach, which make the whole tab read-only', () => {
    const staffMember = makeUserDetail({ roles: [{ key: 'staff', label: { ar: 'موظف' } }, { key: 'teacher', label: { ar: 'معلم' } }] })
    expect(outOfReachHeldRoles(ROLE_OPTIONS, staffMember, LIMITED_ASSIGNER_PERMISSIONS)).toEqual(['staff'])
    expect(outOfReachHeldRoles(ROLE_OPTIONS, staffMember, ADMIN_PERMISSIONS)).toEqual([])
    expect(outOfReachHeldRoles(ROLE_OPTIONS, student, LIMITED_ASSIGNER_PERMISSIONS)).toEqual([])
  })
})
