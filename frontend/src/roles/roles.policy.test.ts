import { describe, expect, it } from 'vitest'
import { ADMIN_ROLE, CATALOG_KEYS, LIBRARIAN_ROLE, LIMITED_MANAGER_PERMISSIONS, REGISTRAR_ROLE, TEACHER_ROLE, makeRole } from '../test/roles'
import {
  buildCreateRoleInput,
  diffPermissions,
  isReservedRoleKey,
  lockedPermissions,
  planRolePatch,
  roleEditability,
  roleFormHasChanges,
  roleFormValuesOf,
  unreachablePermissions,
} from './roles.policy'

describe('roleEditability', () => {
  it('locks academy_admin completely, opens only the permissions of other system roles, and everything of custom roles', () => {
    expect(roleEditability(ADMIN_ROLE)).toEqual({ metadata: false, permissions: false, deletable: false })
    expect(roleEditability(TEACHER_ROLE)).toEqual({ metadata: false, permissions: true, deletable: false })
    expect(roleEditability(LIBRARIAN_ROLE)).toEqual({ metadata: true, permissions: true, deletable: true })
    expect(roleEditability(REGISTRAR_ROLE)).toEqual({ metadata: true, permissions: true, deletable: false })
  })

  it('treats the five system role keys as reserved whatever their case or spacing', () => {
    expect(isReservedRoleKey('academy_admin')).toBe(true)
    expect(isReservedRoleKey(' Teacher ')).toBe(true)
    expect(isReservedRoleKey('librarian')).toBe(false)
  })
})

describe('diffPermissions', () => {
  it('returns the sorted keys to add and to remove, ignoring duplicates and order', () => {
    expect(diffPermissions(['users.read', 'courses.read'], ['courses.read', 'exams.read', 'exams.read', 'courses.manage'])).toEqual({
      added: ['courses.manage', 'exams.read'],
      removed: ['users.read'],
    })
    expect(diffPermissions(['b', 'a'], ['a', 'b'])).toEqual({ added: [], removed: [] })
  })
})

describe('unreachablePermissions / lockedPermissions', () => {
  it('names the keys the caller neither holds nor finds in the learner baseline', () => {
    expect(unreachablePermissions(CATALOG_KEYS, LIMITED_MANAGER_PERMISSIONS)).toEqual(['courses.manage', 'users.read_contact'])
    // `grades.read_own` and `exams.take` are learner baseline keys: reachable even when not held.
    expect(unreachablePermissions(['grades.read_own', 'exams.take', 'roles.manage'], [])).toEqual(['roles.manage'])
  })

  it('does not lock a key the role already holds, so it can be unticked and ticked again', () => {
    expect(lockedPermissions(CATALOG_KEYS, LIMITED_MANAGER_PERMISSIONS, LIBRARIAN_ROLE.permissions)).toEqual(new Set(['courses.manage', 'users.read_contact']))
    expect(lockedPermissions(CATALOG_KEYS, LIMITED_MANAGER_PERMISSIONS, REGISTRAR_ROLE.permissions)).toEqual(new Set(['users.read_contact']))
    expect(lockedPermissions(CATALOG_KEYS, CATALOG_KEYS, [])).toEqual(new Set())
  })
})

describe('planRolePatch', () => {
  it('sends only the changed metadata of a custom role: a new label, a cleared description, the Turkish text carried over', () => {
    const role = makeRole({ label: { ar: 'أمين', en: 'Librarian', tr: 'Kütüphaneci' } })
    const values = { ...roleFormValuesOf(role), labelAr: ' أمين المكتبة ', descriptionAr: '', descriptionEn: '' }

    expect(planRolePatch(role, values)).toEqual({
      label: { ar: 'أمين المكتبة', en: 'Librarian', tr: 'Kütüphaneci' },
      description: null,
    })
  })

  it('sends the complete sorted permission set only when the set changed, and null when nothing differs', () => {
    const role = makeRole({ permissions: ['courses.read', 'users.read'] })
    expect(planRolePatch(role, { ...roleFormValuesOf(role), permissions: ['users.read', 'courses.read'] })).toBeNull()
    expect(planRolePatch(role, { ...roleFormValuesOf(role), permissions: ['users.read', 'exams.read', 'exams.read'] })).toEqual({
      permissions: ['exams.read', 'users.read'],
    })
    expect(planRolePatch(role, { ...roleFormValuesOf(role), labelEn: 'Librarian' })).toBeNull()
  })

  it('ignores metadata on a system role and everything on academy_admin', () => {
    expect(planRolePatch(TEACHER_ROLE, { ...roleFormValuesOf(TEACHER_ROLE), labelAr: 'مدرّس', permissions: ['courses.read'] })).toEqual({
      permissions: ['courses.read'],
    })
    expect(planRolePatch(ADMIN_ROLE, { ...roleFormValuesOf(ADMIN_ROLE), labelAr: 'x', permissions: [] })).toBeNull()
  })
})

describe('buildCreateRoleInput', () => {
  it('normalises the key like the server, drops blank optional locales and a blank description, and sorts the unique permissions', () => {
    expect(
      buildCreateRoleInput({
        key: ' Librarian ',
        labelAr: ' أمين المكتبة ',
        labelEn: '  ',
        descriptionAr: '',
        descriptionEn: '',
        permissions: ['users.read', 'courses.read', 'users.read'],
      }),
    ).toEqual({ key: 'librarian', label: { ar: 'أمين المكتبة' }, permissions: ['courses.read', 'users.read'] })

    expect(buildCreateRoleInput({ key: 'x', labelAr: 'س', descriptionAr: 'وصف', descriptionEn: 'Desc' })).toEqual({
      key: 'x',
      label: { ar: 'س' },
      description: { ar: 'وصف', en: 'Desc' },
      permissions: [],
    })
  })
})

describe('roleFormHasChanges (KI-057 — J-F39)', () => {
  it('holds nothing for an existing role while the form equals the saved values, or was changed back', () => {
    const values = roleFormValuesOf(LIBRARIAN_ROLE)
    expect(roleFormHasChanges(LIBRARIAN_ROLE, values)).toBe(false)
    // Spaces around a text and the order of the ticked keys are no change: the save would send nothing.
    expect(roleFormHasChanges(LIBRARIAN_ROLE, { ...values, labelAr: ' أمين المكتبة ', labelEn: 'Librarian  ' })).toBe(false)
    expect(roleFormHasChanges(REGISTRAR_ROLE, { ...roleFormValuesOf(REGISTRAR_ROLE), permissions: ['users.read', 'courses.read', 'courses.manage'] })).toBe(false)
  })

  it('holds what the smallest PATCH would send: a ticked or unticked key, a changed label, a cleared description', () => {
    const values = roleFormValuesOf(LIBRARIAN_ROLE)
    expect(roleFormHasChanges(LIBRARIAN_ROLE, { ...values, permissions: ['courses.read', 'users.read'] })).toBe(true)
    expect(roleFormHasChanges(LIBRARIAN_ROLE, { ...values, permissions: [] })).toBe(true)
    expect(roleFormHasChanges(LIBRARIAN_ROLE, { ...values, labelEn: 'Head librarian' })).toBe(true)
    expect(roleFormHasChanges(LIBRARIAN_ROLE, { ...values, descriptionAr: '', descriptionEn: '' })).toBe(true)
    // A system role shows its permission set only.
    expect(roleFormHasChanges(TEACHER_ROLE, { permissions: ['courses.read', 'exams.read'] })).toBe(true)
    expect(roleFormHasChanges(TEACHER_ROLE, { permissions: [...TEACHER_ROLE.permissions] })).toBe(false)
  })

  it('holds what the save would refuse instead of sending: an emptied Arabic label, an English description without its Arabic text', () => {
    const values = roleFormValuesOf(LIBRARIAN_ROLE)
    expect(planRolePatch(LIBRARIAN_ROLE, { ...values, labelAr: '  ' })).toBeNull()
    expect(roleFormHasChanges(LIBRARIAN_ROLE, { ...values, labelAr: '  ' })).toBe(true)
    expect(planRolePatch(REGISTRAR_ROLE, { ...roleFormValuesOf(REGISTRAR_ROLE), descriptionEn: 'Enrols students' })).toBeNull()
    expect(roleFormHasChanges(REGISTRAR_ROLE, { ...roleFormValuesOf(REGISTRAR_ROLE), descriptionEn: 'Enrols students' })).toBe(true)
  })

  it('never holds anything for academy_admin, which the editor only shows', () => {
    expect(roleFormHasChanges(ADMIN_ROLE, roleFormValuesOf(ADMIN_ROLE))).toBe(false)
    expect(roleFormHasChanges(ADMIN_ROLE, { ...roleFormValuesOf(ADMIN_ROLE), labelAr: '', permissions: [] })).toBe(false)
  })

  it('holds for a new role anything the POST would send, or an English text without its Arabic one — and nothing for an untouched or blank form', () => {
    expect(roleFormHasChanges(null, { permissions: [] })).toBe(false)
    expect(roleFormHasChanges(null, { key: '  ', labelAr: ' ', labelEn: '', descriptionAr: '', descriptionEn: ' ', permissions: [] })).toBe(false)

    expect(roleFormHasChanges(null, { key: 'L', permissions: [] })).toBe(true)
    expect(roleFormHasChanges(null, { labelAr: 'أمين', permissions: [] })).toBe(true)
    expect(roleFormHasChanges(null, { descriptionAr: 'وصف', permissions: [] })).toBe(true)
    expect(roleFormHasChanges(null, { permissions: ['exams.read'] })).toBe(true)
    expect(roleFormHasChanges(null, { labelEn: 'Librarian', permissions: [] })).toBe(true)
    expect(roleFormHasChanges(null, { descriptionEn: 'Runs the library', permissions: [] })).toBe(true)
  })
})
