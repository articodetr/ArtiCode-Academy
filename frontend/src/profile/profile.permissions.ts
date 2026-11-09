// Pure helpers of the profile page (J-F36): the signed-in user's permission
// keys grouped by area — the prefix before the first dot — under a translated
// heading. The descriptions of API-023 are not read here (it needs
// `roles.manage` and has no cache), so each key stays visible as it is.
// No React, no i18next instance — callers pass `t`.
import type { Translate } from '../users/users.format'

export interface PermissionAreaDefinition {
  /** Prefix of the keys before the first dot, e.g. `users`. */
  area: string
  /** i18n key of the heading. */
  labelKey: string
}

/**
 * Areas of the permission catalog in the declaration order of
 * backend/src/authorization/permission-catalog.ts — a manual mirror, keep it in
 * sync. The headings reuse the module names of the side menu (`nav.*`); only
 * the areas without a menu entry have their own `profile.permissionModules.*`.
 */
export const PERMISSION_AREAS: readonly PermissionAreaDefinition[] = [
  { area: 'academy', labelKey: 'nav.settings' },
  { area: 'branches', labelKey: 'nav.branches' },
  { area: 'users', labelKey: 'nav.users' },
  { area: 'roles', labelKey: 'nav.roles' },
  { area: 'guardians', labelKey: 'profile.permissionModules.guardians' },
  { area: 'courses', labelKey: 'nav.courses' },
  { area: 'classes', labelKey: 'nav.classes' },
  { area: 'enrollments', labelKey: 'profile.permissionModules.enrollments' },
  { area: 'schedule', labelKey: 'nav.schedule' },
  { area: 'lessons', labelKey: 'nav.lessons' },
  { area: 'recordings', labelKey: 'profile.permissionModules.recordings' },
  { area: 'attendance', labelKey: 'profile.permissionModules.attendance' },
  { area: 'assignments', labelKey: 'nav.assignments' },
  { area: 'exams', labelKey: 'nav.exams' },
  { area: 'questions', labelKey: 'profile.permissionModules.questions' },
  { area: 'grades', labelKey: 'profile.permissionModules.grades' },
  { area: 'certificates', labelKey: 'nav.certificates' },
  { area: 'invoices', labelKey: 'profile.permissionModules.invoices' },
  { area: 'payments', labelKey: 'nav.payments' },
  { area: 'fee_plans', labelKey: 'profile.permissionModules.fee_plans' },
  { area: 'notifications', labelKey: 'nav.notifications' },
  { area: 'reports', labelKey: 'nav.reports' },
  { area: 'audit', labelKey: 'nav.audit' },
]

export interface PermissionArea {
  area: string
  /** i18n key of the heading; null for an area the mirror does not know (a newer catalog), shown by its prefix. */
  labelKey: string | null
  /** The area's keys, sorted, each once. */
  keys: string[]
}

/** The area of a key: the prefix before the first dot, or the whole key when it has none. */
export function permissionAreaOf(key: string): string {
  const dot = key.indexOf('.')
  return dot > 0 ? key.slice(0, dot) : key
}

const KNOWN_AREAS: ReadonlyMap<string, string> = new Map(PERMISSION_AREAS.map(({ area, labelKey }) => [area, labelKey]))

/** Known areas in catalog order, then unknown ones by prefix; areas the user holds nothing in are left out. */
export function groupPermissions(keys: readonly string[]): PermissionArea[] {
  const byArea = new Map<string, Set<string>>()
  for (const key of keys) {
    const area = permissionAreaOf(key)
    const held = byArea.get(area) ?? new Set<string>()
    held.add(key)
    byArea.set(area, held)
  }
  const areaOf = (area: string): PermissionArea => ({
    area,
    labelKey: KNOWN_AREAS.get(area) ?? null,
    keys: [...(byArea.get(area) ?? [])].sort(),
  })
  const known = PERMISSION_AREAS.filter(({ area }) => byArea.has(area)).map(({ area }) => areaOf(area))
  const unknown = [...byArea.keys()].filter((area) => !KNOWN_AREAS.has(area)).sort().map(areaOf)
  return [...known, ...unknown]
}

/** Heading of an area: its translated name, or the raw prefix for an unknown area. */
export function permissionAreaLabel(area: Pick<PermissionArea, 'area' | 'labelKey'>, t: Translate): string {
  return area.labelKey ? t(area.labelKey) : area.area
}
