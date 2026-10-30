// Rules of role assignment (MOD-03-T07) as pure functions, so they can be
// unit-tested without a database (users.roles.spec.ts). The service loads the
// target, the requested roles and the caller; these functions decide.
//
//   PUT is a full replacement, written as a diff → { added, removed }
//   a role added with a missing profile completes it: `student` → student_profiles,
//     `teacher`/`staff` → employee_profiles (kind inferred from the one employee
//     role added, or given explicitly when both are)
//   profiles are never removed when a role is (data outlives the role)
//   nobody takes academy_admin away from themself (AC 3)
//   the last active academy_admin keeps the role (AC 2, 5) — checked by the
//     service behind the same row lock as the status changes of T06
import { ACADEMY_ADMIN_ROLE_KEY } from '../authorization/system-roles.js';
import type { EmployeeKind } from '../generated/prisma/client.js';

/** System roles whose holders have an employee profile. */
export const EMPLOYEE_ROLE_KEYS: readonly string[] = ['teacher', 'staff'];

/** The `action` detail of `403 self_forbidden` when a caller takes `academy_admin` from themself. */
export const SELF_FORBIDDEN_ROLES_ACTION = `remove_${ACADEMY_ADMIN_ROLE_KEY}`;

export interface RoleKeyDiff {
  /** Requested keys the user does not hold yet, sorted. */
  added: string[];
  /** Held keys absent from the request, sorted. */
  removed: string[];
}

/** Full replacement: the user ends up with exactly `requested` (duplicates ignored). */
export function diffRoleKeys(current: Iterable<string>, requested: Iterable<string>): RoleKeyDiff {
  const held = new Set(current);
  const wanted = new Set(requested);
  return {
    added: [...wanted].filter((key) => !held.has(key)).sort(),
    removed: [...held].filter((key) => !wanted.has(key)).sort(),
  };
}

/** Whether the request takes `academy_admin` away (the self and last-admin rules apply then). */
export function removesAcademyAdmin(diff: RoleKeyDiff): boolean {
  return diff.removed.includes(ACADEMY_ADMIN_ROLE_KEY);
}

/** The profiles the user already has (what the service selects). */
export interface ProfilePresence {
  hasStudentProfile: boolean;
  /** The kind of the existing employee profile, or null without one. */
  employeeKind: EmployeeKind | null;
}

export type ProfilePlan =
  | {
      kind: 'plan';
      /** Create an empty student profile. */
      student: boolean;
      /** Create an employee profile of this kind, or null. */
      employee: EmployeeKind | null;
    }
  | { kind: 'employee_kind_required'; roleKeys: string[] }
  | { kind: 'profile_mismatch'; detail: string };

/**
 * Which profile rows the added roles require. `employeeKind` is consulted only
 * when an employee profile has to be created; otherwise it must be absent or
 * match the existing profile (an explicit value that would be ignored is a
 * mistake worth reporting).
 */
export function planProfiles(
  added: readonly string[],
  present: ProfilePresence,
  employeeKind: EmployeeKind | undefined,
): ProfilePlan {
  const student = added.includes('student') && !present.hasStudentProfile;
  const employeeRoles = added.filter((key) => EMPLOYEE_ROLE_KEYS.includes(key));

  if (present.employeeKind !== null) {
    if (employeeKind !== undefined && employeeKind !== present.employeeKind) {
      return {
        kind: 'profile_mismatch',
        detail: `employeeKind: this user already has an employee profile of kind "${present.employeeKind}"; the kind is not changed here`,
      };
    }
    return { kind: 'plan', student, employee: null };
  }
  if (employeeRoles.length === 0) {
    if (employeeKind !== undefined) {
      return { kind: 'profile_mismatch', detail: 'employeeKind is only accepted when "teacher" or "staff" is added to a user without an employee profile' };
    }
    return { kind: 'plan', student, employee: null };
  }
  const inferred = employeeRoles.length === 1 ? (employeeRoles[0] as EmployeeKind) : undefined;
  const employee = employeeKind ?? inferred;
  if (employee === undefined) return { kind: 'employee_kind_required', roleKeys: employeeRoles };
  return { kind: 'plan', student, employee };
}
