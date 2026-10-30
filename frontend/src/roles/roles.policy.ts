// Rules of the roles screen (MOD-03-T13) as pure functions, mirroring
// backend/src/roles/roles.policy.ts and users.policy.ts so the UI refuses
// locally what the server would refuse. The server stays the authority.
//
//   academy_admin is read-only; other system roles accept permission changes only
//   custom roles accept everything and can be deleted while nobody holds them
//   a save is the full permission set, computed as a diff → nothing to send when equal
//   no key may be granted that the caller lacks (learner baseline excepted — ADR-030)
import type { CreateRoleInput, LocalizedLabel, Role, UpdateRoleInput } from '../api/roles'
import { SYSTEM_ROLE_KEYS } from '../users/users.format'

export const ACADEMY_ADMIN_ROLE_KEY = 'academy_admin'
/** `LocalizedTextDto` length limit of every locale (roles.dto.ts). */
export const LOCALIZED_TEXT_MAX_LENGTH = 200
/** `ArrayMaxSize` of the `permissions` body field (roles.dto.ts). */
export const ROLE_PERMISSIONS_MAX = 200

/** Keys of the seeded system roles are reserved: the server answers `409 role_in_use` on POST. */
export function isReservedRoleKey(key: string): boolean {
  return (SYSTEM_ROLE_KEYS as readonly string[]).includes(key.trim().toLowerCase())
}

export interface RoleEditability {
  /** Label and description (custom roles only — the seed owns the system roles' texts). */
  metadata: boolean
  /** The permission set (every role but `academy_admin`, which always holds the whole catalog). */
  permissions: boolean
  /** Custom roles nobody holds (`409 role_in_use` otherwise, `403 role_immutable` for system roles). */
  deletable: boolean
}

export function roleEditability(role: Pick<Role, 'key' | 'isSystem' | 'userCount'>): RoleEditability {
  if (!role.isSystem) return { metadata: true, permissions: true, deletable: role.userCount === 0 }
  return { metadata: false, permissions: role.key !== ACADEMY_ADMIN_ROLE_KEY, deletable: false }
}

export interface PermissionDiff {
  /** Requested keys the role does not hold yet, sorted. */
  added: string[]
  /** Held keys absent from the request, sorted. */
  removed: string[]
}

/** Full replacement: the role ends up with exactly `requested` (duplicates ignored). */
export function diffPermissions(current: Iterable<string>, requested: Iterable<string>): PermissionDiff {
  const held = new Set(current)
  const wanted = new Set(requested)
  const added = [...wanted].filter((key) => !held.has(key)).sort()
  const removed = [...held].filter((key) => !wanted.has(key)).sort()
  return { added, removed }
}

/**
 * Seeded defaults of `student` and `guardian` (backend/src/authorization/
 * system-roles.ts — LEARNER_BASELINE_PERMISSIONS). Granting them never
 * elevates anyone, so the no-exceeding rule exempts exactly these keys.
 */
export const LEARNER_BASELINE_PERMISSIONS: ReadonlySet<string> = new Set([
  // student
  'courses.read',
  'schedule.read',
  'lessons.read',
  'assignments.read',
  'assignments.submit',
  'exams.read',
  'exams.take',
  'grades.read_own',
  'certificates.read_own',
  'invoices.read_own',
  // guardian
  'attendance.read',
  'grades.read_linked',
  'certificates.read_linked',
  'invoices.read_linked',
])

/** Keys the caller can never grant: neither held nor in the learner baseline (`exceedingPermissions()`), sorted. */
export function unreachablePermissions(keys: Iterable<string>, callerPermissions: readonly string[]): string[] {
  const held = new Set(callerPermissions)
  const unreachable = new Set<string>()
  for (const key of keys) {
    if (!held.has(key) && !LEARNER_BASELINE_PERMISSIONS.has(key)) unreachable.add(key)
  }
  return [...unreachable].sort()
}

/**
 * Keys the editor locks for this caller: unreachable keys the role does not
 * hold yet. A held key stays free — unticking and ticking it again adds
 * nothing, and removing is never subject to the rule (API-025).
 */
export function lockedPermissions(
  catalogKeys: Iterable<string>,
  callerPermissions: readonly string[],
  currentPermissions: Iterable<string>,
): Set<string> {
  const held = new Set(currentPermissions)
  return new Set(unreachablePermissions(catalogKeys, callerPermissions).filter((key) => !held.has(key)))
}

/** Values of the editor form: one text field per locale, keys of the ticked permissions. */
export interface RoleFormValues {
  /** Creation only. */
  key?: string
  labelAr?: string
  labelEn?: string
  descriptionAr?: string
  descriptionEn?: string
  permissions?: string[]
}

export function roleFormValuesOf(role: Role): RoleFormValues {
  return {
    labelAr: role.label.ar,
    labelEn: role.label.en ?? '',
    descriptionAr: role.description?.ar ?? '',
    descriptionEn: role.description?.en ?? '',
    permissions: [...role.permissions],
  }
}

/** Trims every locale; a blank Arabic text means "no text" (null); blank optional locales are dropped; `tr` is carried over untouched. */
export function localizedOf(ar: string | undefined, en: string | undefined, tr?: string): LocalizedLabel | null {
  const arabic = (ar ?? '').trim()
  if (!arabic) return null
  const text: LocalizedLabel = { ar: arabic }
  const english = (en ?? '').trim()
  if (english) text.en = english
  if (tr) text.tr = tr
  return text
}

export function sameLocalized(a: LocalizedLabel | null, b: LocalizedLabel | null): boolean {
  if (a === null || b === null) return a === b
  return a.ar === b.ar && (a.en ?? null) === (b.en ?? null) && (a.tr ?? null) === (b.tr ?? null)
}

/** Unique, sorted — the shape the server stores and returns. */
export function normalisePermissions(keys: Iterable<string> | undefined): string[] {
  return [...new Set(keys ?? [])].sort()
}

/** Body of API-024 from the creation form (key normalised like the server: trim + lower-case). */
export function buildCreateRoleInput(values: RoleFormValues): CreateRoleInput {
  const input: CreateRoleInput = {
    key: (values.key ?? '').trim().toLowerCase(),
    label: localizedOf(values.labelAr, values.labelEn) ?? { ar: '' },
    permissions: normalisePermissions(values.permissions),
  }
  const description = localizedOf(values.descriptionAr, values.descriptionEn)
  if (description) input.description = description
  return input
}

/**
 * The PATCH body that moves `current` to `values`, or null when nothing
 * differs: label/description only for custom roles (compared value by value,
 * `null` clears the description), `permissions` as the complete new set only
 * when the set changed — never for `academy_admin`.
 */
export function planRolePatch(current: Role, values: RoleFormValues): UpdateRoleInput | null {
  const body: UpdateRoleInput = {}
  const editability = roleEditability(current)

  if (editability.metadata) {
    const label = localizedOf(values.labelAr, values.labelEn, current.label.tr)
    if (label && !sameLocalized(current.label, label)) body.label = label
    const description = localizedOf(values.descriptionAr, values.descriptionEn, current.description?.tr)
    if (!sameLocalized(current.description, description)) body.description = description
  }

  if (editability.permissions) {
    const requested = normalisePermissions(values.permissions)
    const diff = diffPermissions(current.permissions, requested)
    if (diff.added.length > 0 || diff.removed.length > 0) body.permissions = requested
  }

  return Object.keys(body).length === 0 ? null : body
}
