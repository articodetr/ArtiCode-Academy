import { describe, expect, it } from 'vitest'
import type { Role } from '../auth/roles'
import { NAV_ITEMS, canAccess, navFor } from './navigation'
import type { NavViewer } from './navigation'

/** The MOD-03/MOD-14 keys the seeded system roles hold (backend/src/authorization/system-roles.ts). */
const SEEDED: Readonly<Record<Role, string[]>> = {
  admin: ['users.read', 'users.read_contact', 'roles.manage', 'audit.read', 'academy.settings.read', 'academy.settings.manage'],
  staff: ['users.read', 'users.read_contact', 'users.create', 'users.update', 'guardians.link'],
  teacher: ['users.read', 'courses.read', 'lessons.manage'],
  student: ['courses.read', 'assignments.submit'],
  guardian: ['courses.read', 'grades.read_linked'],
}

function viewer(role: Role | null, permissions: string[] = role ? SEEDED[role] : []): NavViewer {
  return { role, permissions }
}

function keysFor(user: NavViewer): string[] {
  return navFor(user).map((item) => item.key)
}

describe('NAV_ITEMS', () => {
  it('has unique keys and paths, and every entry is gated either by permissions or by the role matrix', () => {
    const keys = NAV_ITEMS.map((item) => item.key)
    const paths = NAV_ITEMS.map((item) => item.path)
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(paths).size).toBe(paths.length)
    for (const item of NAV_ITEMS) {
      expect(Boolean(item.permissions) !== Boolean(item.roles)).toBe(true)
    }
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

  it('ignores the role for permission-gated entries: an admin whose role lost users.read does not see the users (or settings) page', () => {
    expect(keysFor(viewer('admin', ['roles.manage']))).toEqual(['dashboard', 'roles', 'courses', 'classes', 'schedule', 'lessons', 'assignments', 'exams', 'certificates', 'payments', 'notifications', 'reports'])
  })

  it('keeps the role matrix of the system roles for the screens without a server contract — AC3', () => {
    expect(keysFor(viewer('admin'))).toEqual(['dashboard', 'users', 'roles', 'courses', 'classes', 'schedule', 'lessons', 'assignments', 'exams', 'certificates', 'payments', 'notifications', 'reports', 'audit', 'settings'])
    expect(keysFor(viewer('staff'))).toEqual(['dashboard', 'users', 'classes', 'schedule', 'payments', 'notifications'])
    expect(keysFor(viewer('student'))).toEqual(['dashboard', 'courses', 'schedule', 'lessons', 'assignments', 'exams', 'certificates', 'payments', 'notifications'])
    expect(keysFor(viewer('guardian'))).toEqual(['dashboard', 'courses', 'schedule', 'assignments', 'exams', 'certificates', 'payments', 'notifications'])
  })

  it('shows the users page to a teacher because the seed grants teachers users.read (reduced projection) — the one visible change for a system role', () => {
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
