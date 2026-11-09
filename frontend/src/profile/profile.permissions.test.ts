import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { ADMIN_SESSION_PERMISSIONS, CATALOG_PERMISSION_KEYS, STUDENT_SESSION_PERMISSIONS } from '../test/profile'
import { PERMISSION_AREAS, groupPermissions, permissionAreaLabel, permissionAreaOf } from './profile.permissions'

/** The value at a dotted path of a translation dictionary, as i18next resolves a key. */
function lookup(dictionary: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined),
      dictionary,
    )
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)

describe('profile permission areas (J-F36)', () => {
  it('takes the prefix before the first dot as the area', () => {
    expect(permissionAreaOf('users.read')).toBe('users')
    expect(permissionAreaOf('notifications.templates.manage')).toBe('notifications')
    expect(permissionAreaOf('fee_plans.manage')).toBe('fee_plans')
    expect(permissionAreaOf('standalone')).toBe('standalone')
  })

  it('orders the areas like the catalog, sorts each area once and puts unknown areas last by prefix', () => {
    const areas = groupPermissions(['users.read', 'zeta.run', 'academy.settings.read', 'users.create', 'alpha.view', 'users.read'])

    expect(areas).toEqual([
      { area: 'academy', labelKey: 'nav.settings', keys: ['academy.settings.read'] },
      { area: 'users', labelKey: 'nav.users', keys: ['users.create', 'users.read'] },
      { area: 'alpha', labelKey: null, keys: ['alpha.view'] },
      { area: 'zeta', labelKey: null, keys: ['zeta.run'] },
    ])
    expect(groupPermissions([])).toEqual([])
  })

  it('knows every area of the catalog, each once, in declaration order', () => {
    const catalogAreas = [...new Set(CATALOG_PERMISSION_KEYS.map(permissionAreaOf))]
    expect(PERMISSION_AREAS.map(({ area }) => area)).toEqual(catalogAreas)

    const areas = groupPermissions(ADMIN_SESSION_PERMISSIONS)
    expect(areas).toHaveLength(23)
    expect(areas.map(({ area }) => area)).toEqual(catalogAreas)
    expect(areas.every(({ labelKey }) => labelKey !== null)).toBe(true)
    expect(areas.reduce((sum, { keys }) => sum + keys.length, 0)).toBe(57)
    expect(areas.find(({ area }) => area === 'users')?.keys).toEqual([
      'users.create',
      'users.deactivate',
      'users.read',
      'users.read_contact',
      'users.roles.assign',
      'users.update',
    ])
  })

  it('names every area in Arabic and English, reusing the menu names and adding only the areas without a menu entry', () => {
    for (const { area, labelKey } of PERMISSION_AREAS) {
      expect(lookup(ar, labelKey), `${area} → ${labelKey} (ar)`).toEqual(expect.stringMatching(/\S/))
      expect(lookup(en, labelKey), `${area} → ${labelKey} (en)`).toEqual(expect.stringMatching(/\S/))
    }
    const own = PERMISSION_AREAS.filter(({ labelKey }) => !labelKey.startsWith('nav.')).map(({ area }) => area)
    expect(own).toEqual(Object.keys(ar.profile.permissionModules))
    expect(Object.keys(en.profile.permissionModules)).toEqual(Object.keys(ar.profile.permissionModules))
  })

  it('shows the translated heading, or the prefix of an unknown area', () => {
    const areas = groupPermissions(STUDENT_SESSION_PERMISSIONS)

    expect(areas.map((area) => permissionAreaLabel(area, t))).toEqual([
      ar.nav.courses,
      ar.nav.schedule,
      ar.nav.lessons,
      ar.nav.assignments,
      ar.nav.exams,
      ar.profile.permissionModules.grades,
      ar.nav.certificates,
      ar.profile.permissionModules.invoices,
    ])
    expect(permissionAreaLabel({ area: 'zeta', labelKey: null }, t)).toBe('zeta')
  })
})
