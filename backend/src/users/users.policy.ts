// Authorisation rules of user creation (MOD-03-T02) as pure functions, so they
// can be unit-tested without a database (users.policy.spec.ts). The service
// loads the roles and the caller; these functions decide.
//
//   kind → default role and profile   (KIND_ROLE_KEYS in authorization/)
//   extra roles need `users.roles.assign`                   (AC 5, D-R03)
//   no role may confer a permission the creator lacks       (owner rule, CH-0018)
//     except the learner baseline (seeded student/guardian keys), which carries
//     no capability over other people's data
//   extra system roles must stay consistent with the profile the kind creates
import { LEARNER_BASELINE_PERMISSIONS } from '../authorization/system-roles.js';
import type { KindRoleKey } from '../authorization/system-roles.js';

export const ASSIGN_ROLES_PERMISSION = 'users.roles.assign';
export const CREATE_USERS_PERMISSION = 'users.create';
/** Reveals e-mail, username, phone and account-security timestamps in reads (D-R07). */
export const READ_CONTACT_PERMISSION = 'users.read_contact';

export type ProfileKind = 'student' | 'employee' | null;

/** Which profile row a kind creates. */
export function profileKindFor(kind: KindRoleKey): ProfileKind {
  if (kind === 'student') return 'student';
  if (kind === 'teacher' || kind === 'staff') return 'employee';
  return null;
}

/** Requested extra roles minus duplicates and minus the kind's own role, in request order. */
export function extraRoleKeys(kind: KindRoleKey, requested: readonly string[] | undefined): string[] {
  const extras: string[] = [];
  for (const key of requested ?? []) {
    if (key !== kind && !extras.includes(key)) extras.push(key);
  }
  return extras;
}

export type ExtraRoleProblem =
  | { code: 'profile_mismatch'; roleKey: 'student' }
  | { code: 'employee_kind_required'; roleKeys: string[] };

/**
 * Extra system roles that need a profile the kind does not create are refused:
 * `student` needs student_profiles; `teacher`/`staff` need employee_profiles
 * with a kind. (Adding them later with their profile is MOD-03-T07.)
 */
export function extraRoleProfileProblem(kind: KindRoleKey, extras: readonly string[]): ExtraRoleProblem | null {
  const profile = profileKindFor(kind);
  if (profile !== 'student' && extras.includes('student')) return { code: 'profile_mismatch', roleKey: 'student' };
  const employeeRoles = extras.filter((key) => key === 'teacher' || key === 'staff');
  if (profile !== 'employee' && employeeRoles.length > 0) return { code: 'employee_kind_required', roleKeys: employeeRoles };
  return null;
}

/**
 * Permission keys the granted roles would confer that the caller neither holds
 * nor belong to the learner baseline — sorted, empty when the grant is safe.
 */
export function exceedingPermissions(
  conferred: Iterable<string>,
  callerPermissions: readonly string[],
  baseline: ReadonlySet<string> = LEARNER_BASELINE_PERMISSIONS,
): string[] {
  const held = new Set(callerPermissions);
  const exceeding = new Set<string>();
  for (const key of conferred) {
    if (!held.has(key) && !baseline.has(key)) exceeding.add(key);
  }
  return [...exceeding].sort();
}
