// Rules of the roles tab (MOD-03-T14) as pure functions, mirroring
// backend/src/users/users.roles.ts and users.policy.ts so the UI refuses
// locally what the server would refuse (API-034, ADR-037). The server stays
// the authority.
//
//   PUT is a full replacement, computed here as a diff → nothing to send when equal
//   a role the caller could not grant (no-exceeding rule, SEC-R-16) is locked unless held
//   a user holding a role out of the caller's reach is read-only altogether (SEC-R-17)
//   nobody takes academy_admin away from themself (403 self_forbidden)
//   adding both employee roles to a user without an employee profile needs `employeeKind`
import type { Role } from '../api/roles'
import type { EmployeeKind, ReplaceUserRolesInput, UserDetail } from '../api/users'
import type { Language } from '../i18n/language'
import { ACADEMY_ADMIN_ROLE_KEY, unreachablePermissions } from '../roles/roles.policy'
import { localizedLabel } from './users.format'

export { ACADEMY_ADMIN_ROLE_KEY }

/** System roles whose holders have an employee profile. */
export const EMPLOYEE_ROLE_KEYS: readonly string[] = ['teacher', 'staff']

export interface RoleKeyDiff {
  /** Requested keys the user does not hold yet, sorted. */
  added: string[]
  /** Held keys absent from the request, sorted. */
  removed: string[]
}

/** Unique, trimmed, lower-cased, sorted — the shape the server stores and returns. */
export function normaliseRoleKeys(keys: Iterable<string> | undefined): string[] {
  const unique = new Set<string>()
  for (const key of keys ?? []) {
    const normalised = key.trim().toLowerCase()
    if (normalised) unique.add(normalised)
  }
  return [...unique].sort()
}

/** Full replacement: the user ends up with exactly `requested` (duplicates ignored). */
export function diffRoleKeys(current: Iterable<string>, requested: Iterable<string>): RoleKeyDiff {
  const held = new Set(current)
  const wanted = new Set(requested)
  return {
    added: [...wanted].filter((key) => !held.has(key)).sort(),
    removed: [...held].filter((key) => !wanted.has(key)).sort(),
  }
}

export function heldRoleKeys(user: Pick<UserDetail, 'roles'>): string[] {
  return user.roles.map((role) => role.key)
}

/**
 * `employeeKind` must be given when both employee roles are added to a user
 * without an employee profile (`422 employee_kind_required` otherwise); with one
 * of them the server infers it, with an existing profile it must stay absent.
 */
export function employeeKindRequired(user: Pick<UserDetail, 'employeeProfile'>, added: readonly string[]): boolean {
  return user.employeeProfile === null && EMPLOYEE_ROLE_KEYS.every((key) => added.includes(key))
}

/** Whether the request takes `academy_admin` away from the signed-in user themself. */
export function removesOwnAdmin(user: Pick<UserDetail, 'id' | 'roles'>, selfId: string | null, requested: Iterable<string>): boolean {
  if (selfId === null || selfId !== user.id) return false
  return diffRoleKeys(heldRoleKeys(user), normaliseRoleKeys(requested)).removed.includes(ACADEMY_ADMIN_ROLE_KEY)
}

/**
 * Body of API-034, or null when nothing changes (the server would answer 200
 * without an event anyway — no request then). `employeeKind` travels only
 * when the server would ask for it.
 */
export function planRolesReplacement(user: UserDetail, requested: Iterable<string>, employeeKind?: EmployeeKind): ReplaceUserRolesInput | null {
  const roleKeys = normaliseRoleKeys(requested)
  const diff = diffRoleKeys(heldRoleKeys(user), roleKeys)
  if (diff.added.length === 0 && diff.removed.length === 0) return null
  const body: ReplaceUserRolesInput = { roleKeys }
  if (employeeKind && employeeKindRequired(user, diff.added)) body.employeeKind = employeeKind
  return body
}

/**
 * Held roles that confer a permission the caller lacks: the server refuses any
 * change on such a user before looking at the request (SEC-R-17), so the tab
 * is read-only then. Sorted; empty when every held role is within reach.
 */
export function outOfReachHeldRoles(roles: readonly Role[], user: Pick<UserDetail, 'roles'>, callerPermissions: readonly string[]): string[] {
  const byKey = new Map(roles.map((role) => [role.key, role]))
  return heldRoleKeys(user)
    .filter((key) => {
      const role = byKey.get(key)
      return role ? unreachablePermissions(role.permissions, callerPermissions).length > 0 : false
    })
    .sort()
}

/** Why an option cannot be picked: the caller could not grant it, or it is the caller's own admin role. */
export type RoleOptionLock = 'unreachable' | 'self_admin'

export interface RoleOption {
  value: string
  label: string
  isSystem: boolean
  lock: RoleOptionLock | null
}

export interface RoleOptionsContext {
  permissions: readonly string[]
  selfId: string | null
  language: Language
}

/**
 * Options of the roles select: every role of API-022 with its localized label.
 * A role the caller could not grant is locked unless the user already holds it
 * (keeping it adds nothing); `academy_admin` is locked on oneself so the tag
 * cannot be removed (the server would answer `self_forbidden`).
 */
export function roleOptionsFor(roles: readonly Role[], user: Pick<UserDetail, 'id' | 'roles'>, context: RoleOptionsContext): RoleOption[] {
  const held = new Set(heldRoleKeys(user))
  const self = context.selfId !== null && context.selfId === user.id
  return roles.map((role) => {
    let lock: RoleOptionLock | null = null
    if (self && role.key === ACADEMY_ADMIN_ROLE_KEY && held.has(role.key)) lock = 'self_admin'
    else if (!held.has(role.key) && unreachablePermissions(role.permissions, context.permissions).length > 0) lock = 'unreachable'
    return { value: role.key, label: localizedLabel(role.label, context.language), isSystem: role.isSystem, lock }
  })
}
