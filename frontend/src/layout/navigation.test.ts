import { describe, expect, it } from 'vitest'
import type { Role } from '../auth/roles'
import { NAV_ITEMS, canAccess, navFor } from './navigation'
import type { NavViewer } from './navigation'

/** The MOD-03/MOD-04/MOD-05/MOD-07/MOD-14 keys the seeded system roles hold (backend/src/authorization/system-roles.ts). */
const SEEDED: Readonly<Record<Role, string[]>> = {
  admin: ['users.read', 'users.read_contact', 'roles.manage', 'audit.read', 'academy.settings.read', 'academy.settings.manage', 'courses.read', 'courses.manage', 'classes.read', 'classes.manage', 'classes.teachers.assign', 'schedule.read', 'schedule.manage'],
  staff: ['users.read', 'users.read_contact', 'users.create', 'users.update', 'guardians.link', 'courses.read', 'classes.read', 'classes.manage', 'schedule.read'],
  teacher: ['users.read', 'courses.read', 'classes.read', 'lessons.manage', 'schedule.read'],
  student: ['courses.read', 'assignments.submit', 'schedule.read'],
  guardian: ['courses.read', 'grades.read_linked', 'schedule.read'],
}

/** Server role keys of the UI roles (backend/src/authorization/system-roles.ts). */
const ROLE_KEYS: Readonly<Record<Role, string>> = { admin: 'academy_admin', staff: 'staff', teacher: 'teacher', student: 'student', guardian: 'guardian' }

function viewer(role: Role | null, permissions: string[] = role ? SEEDED[role] : [], roles: string[] = role ? [ROLE_KEYS[role]] : []): NavViewer {
  return { role, roles, permissions }
}

function keysFor(user: NavViewer): string[] {
  return navFor(user).map((item) => item.key)
}

describe('NAV_ITEMS', () => {
  it('has unique keys and paths, and every entry is gated by exactly one of: permissions, server role keys, the role matrix', () => {
    const keys = NAV_ITEMS.map((item) => item.key)
    const paths = NAV_ITEMS.map((item) => item.path)
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(paths).size).toBe(paths.length)
    for (const item of NAV_ITEMS) {
      expect([item.permissions, item.roleKeys, item.roles].filter(Boolean)).toHaveLength(1)
    }
  })

  it('gates «my classes» by the student/guardian server role keys since API-060 is ownership without a permission key (J-F04)', () => {
    const myClasses = NAV_ITEMS.find((item) => item.key === 'myClasses')!
    expect(myClasses.roleKeys).toEqual(['student', 'guardian'])
    expect(myClasses.path).toBe('/my-classes')
    expect(keysFor(viewer('student'))).toContain('myClasses')
    expect(keysFor(viewer('guardian'))).toContain('myClasses')
    // The server rule looks at the role keys, not the single UI role: a teacher who is also a guardian keeps the entry…
    expect(keysFor(viewer('teacher', SEEDED.teacher, ['teacher', 'guardian']))).toContain('myClasses')
    expect(canAccess(viewer('teacher', SEEDED.teacher, ['teacher', 'guardian']), 'myClasses')).toBe(true)
    // …and an admin, a teacher or a custom role without those keys gets no entry (the server would answer an empty list).
    expect(keysFor(viewer('admin'))).not.toContain('myClasses')
    expect(keysFor(viewer('teacher'))).not.toContain('myClasses')
    expect(canAccess(viewer(null, ['users.read'], ['auditor']), 'myClasses')).toBe(false)
    // Permissions never open it: the entry mirrors ownership, not a key.
    expect(canAccess(viewer(null, ['enrollments.read', 'enrollments.manage']), 'myClasses')).toBe(false)
  })

  it('gates the MOD-03 screens by the keys the server enforces', () => {
    const byKey = Object.fromEntries(NAV_ITEMS.map((item) => [item.key, item]))
    expect(byKey.users.permissions).toEqual(['users.read'])
    expect(byKey.roles.permissions).toEqual(['roles.manage'])
    expect(byKey.roles.path).toBe('/settings/roles')
    expect(byKey.audit.permissions).toEqual(['audit.read'])
    expect(byKey.audit.path).toBe('/audit-logs')
  })

  it('gates the settings screen by the academy settings keys since the general tab is real (MOD-02/MOD-14)', () => {
    const settings = NAV_ITEMS.find((item) => item.key === 'settings')!
    expect(settings.permissions).toEqual(['academy.settings.read', 'academy.settings.manage'])
    expect(keysFor(viewer(null, ['academy.settings.read']))).toEqual(['dashboard', 'settings'])
    expect(keysFor(viewer(null, ['academy.settings.manage']))).toEqual(['dashboard', 'settings'])
    expect(canAccess(viewer('admin', []), 'settings')).toBe(false)
  })

  it('gates the courses screen by courses.read since its API is real (MOD-04-T05) — any role holding it sees it', () => {
    const courses = NAV_ITEMS.find((item) => item.key === 'courses')!
    expect(courses.permissions).toEqual(['courses.read'])
    expect(keysFor(viewer(null, ['courses.read']))).toEqual(['dashboard', 'courses'])
    expect(keysFor(viewer(null, ['courses.manage']))).toEqual(['dashboard'])
    expect(canAccess(viewer('student', []), 'courses')).toBe(false)
  })

  it('gates the schedule screen by schedule.read, schedule.manage or classes.manage since its API is real (J-F05, D-R27)', () => {
    const schedule = NAV_ITEMS.find((item) => item.key === 'schedule')!
    expect(schedule.permissions).toEqual(['schedule.read', 'schedule.manage', 'classes.manage'])
    expect(keysFor(viewer(null, ['schedule.read']))).toEqual(['dashboard', 'schedule'])
    expect(keysFor(viewer(null, ['classes.manage']))).toEqual(['dashboard', 'schedule'])
    expect(keysFor(viewer(null, ['schedule.manage']))).toEqual(['dashboard', 'schedule'])
    expect(canAccess(viewer('student', []), 'schedule')).toBe(false)
  })

  it('gates the classes screen by classes.read alone since every read of /api/classes requires it (J-F01, PR #26 review) — students and guardians do not hold it', () => {
    const classes = NAV_ITEMS.find((item) => item.key === 'classes')!
    expect(classes.permissions).toEqual(['classes.read'])
    expect(keysFor(viewer(null, ['classes.read']))).toEqual(['dashboard', 'classes'])
    // A custom role holding classes.manage without classes.read would get 403 on the list — the entry stays hidden
    // (classes.manage does open the academy schedule — J-F05).
    expect(keysFor(viewer(null, ['classes.manage']))).toEqual(['dashboard', 'schedule'])
    expect(keysFor(viewer(null, ['classes.manage', 'classes.teachers.assign']))).toEqual(['dashboard', 'schedule'])
    expect(canAccess(viewer(null, ['classes.manage']), 'classes')).toBe(false)
    expect(keysFor(viewer(null, ['classes.teachers.assign']))).toEqual(['dashboard'])
    expect(canAccess(viewer('student'), 'classes')).toBe(false)
    expect(canAccess(viewer('guardian'), 'classes')).toBe(false)
  })
})

describe('navFor', () => {
  it('shows a custom role holding users.read only the users page (plus the landing page) — AC1', () => {
    expect(keysFor(viewer(null, ['users.read']))).toEqual(['dashboard', 'users'])
  })

  it('shows a custom role each MOD-03 entry by its own key, whatever the role', () => {
    expect(keysFor(viewer(null, ['roles.manage']))).toEqual(['dashboard', 'roles'])
    expect(keysFor(viewer(null, ['audit.read']))).toEqual(['dashboard', 'audit'])
    expect(keysFor(viewer(null, []))).toEqual(['dashboard'])
  })

  it('ignores the role for permission-gated entries: an admin whose role lost users.read does not see the users (or courses, classes, settings) page', () => {
    // Since J-F05 the schedule entry is permission-gated too (schedule.read / schedule.manage / classes.manage).
    expect(keysFor(viewer('admin', ['roles.manage']))).toEqual(['dashboard', 'roles', 'lessons', 'assignments', 'exams', 'certificates', 'payments', 'notifications', 'reports'])
  })

  it('keeps the role matrix of the system roles for the screens without a server contract — AC3', () => {
    expect(keysFor(viewer('admin'))).toEqual(['dashboard', 'users', 'roles', 'courses', 'classes', 'schedule', 'lessons', 'assignments', 'exams', 'certificates', 'payments', 'notifications', 'reports', 'audit', 'settings'])
    // Staff gain the courses entry (MOD-04-T05): the seed grants them courses.read.
    expect(keysFor(viewer('staff'))).toEqual(['dashboard', 'users', 'courses', 'classes', 'schedule', 'payments', 'notifications'])
    // Students and guardians gain «my classes» (J-F04): ownership, by their server role keys.
    expect(keysFor(viewer('student'))).toEqual(['dashboard', 'courses', 'myClasses', 'schedule', 'lessons', 'assignments', 'exams', 'certificates', 'payments', 'notifications'])
    expect(keysFor(viewer('guardian'))).toEqual(['dashboard', 'courses', 'myClasses', 'schedule', 'assignments', 'exams', 'certificates', 'payments', 'notifications'])
  })

  it('shows the users page to a teacher because the seed grants teachers users.read (reduced projection) (MOD-03-T15)', () => {
    expect(keysFor(viewer('teacher'))).toEqual(['dashboard', 'users', 'courses', 'classes', 'schedule', 'lessons', 'assignments', 'exams', 'notifications'])
    expect(keysFor(viewer('teacher', ['courses.read']))).not.toContain('users')
  })
})

describe('canAccess', () => {
  it('answers by the same rule as the menu, and false for an unknown key', () => {
    expect(canAccess(viewer(null, ['users.read']), 'users')).toBe(true)
    expect(canAccess(viewer(null, ['users.read']), 'roles')).toBe(false)
    expect(canAccess(viewer(null, []), 'dashboard')).toBe(true)
    expect(canAccess(viewer('staff'), 'settings')).toBe(false)
    expect(canAccess(viewer('admin'), 'settings')).toBe(true)
    expect(canAccess(viewer('admin'), 'nope')).toBe(false)
  })
})
