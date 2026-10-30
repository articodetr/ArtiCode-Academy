// Rules of role management (MOD-03-T08) as pure functions, unit-tested in
// roles.policy.spec.ts without a database. The service loads the role, the
// active catalog and the caller; these functions decide.
//
//   system role keys are reserved — a custom role can never take one
//   academy_admin is immutable; other system roles accept permission changes only
//   a PATCH is a full replacement of the permission set → { added, removed }
//   no grant may confer a permission the caller lacks (learner baseline excepted)
import { ACADEMY_ADMIN_ROLE_KEY, SYSTEM_ROLE_KEYS } from '../authorization/system-roles.js';

export const MANAGE_ROLES_PERMISSION = 'roles.manage';
/** Listing roles is part of reading users (the detail shows them). */
export const READ_ROLES_PERMISSION = 'users.read';

/** Keys of the seeded system roles stay reserved even if a row were missing. */
export function isReservedRoleKey(key: string): boolean {
  return SYSTEM_ROLE_KEYS.includes(key);
}

export interface RoleIdentity {
  key: string;
  isSystem: boolean;
}

export interface RolePatchFields {
  label?: unknown;
  description?: unknown;
  permissions?: unknown;
}

export type RoleImmutability =
  | { kind: 'immutable'; key: string }
  | { kind: 'fields_immutable'; key: string; fields: string[] }
  | null;

/**
 * Which part of a PATCH a system role refuses: `academy_admin` refuses every
 * change (it always holds the whole catalog — the seed re-grants it), the other
 * system roles own their label and description (the seed refreshes them) and
 * accept permission changes only. Custom roles accept everything.
 */
export function rolePatchImmutability(role: RoleIdentity, patch: RolePatchFields): RoleImmutability {
  if (!role.isSystem) return null;
  if (role.key === ACADEMY_ADMIN_ROLE_KEY) return { kind: 'immutable', key: role.key };
  const fields: string[] = [];
  if (patch.label !== undefined) fields.push('label');
  if (patch.description !== undefined) fields.push('description');
  return fields.length > 0 ? { kind: 'fields_immutable', key: role.key, fields } : null;
}

export interface PermissionDiff {
  /** Requested keys the role does not hold yet, sorted. */
  added: string[];
  /** Held keys (deprecated grants included) absent from the request, sorted. */
  removed: string[];
}

/** Full replacement: the role ends up with exactly `requested` (duplicates ignored). */
export function diffPermissions(current: Iterable<string>, requested: Iterable<string>): PermissionDiff {
  const held = new Set(current);
  const wanted = new Set(requested);
  const added = [...wanted].filter((key) => !held.has(key)).sort();
  const removed = [...held].filter((key) => !wanted.has(key)).sort();
  return { added, removed };
}

/** Requested keys that are not in the active catalog (unknown or deprecated), sorted. */
export function unknownPermissionKeys(requested: Iterable<string>, active: ReadonlySet<string>): string[] {
  const unknown = new Set<string>();
  for (const key of requested) {
    if (!active.has(key)) unknown.add(key);
  }
  return [...unknown].sort();
}
