// «My grades» of MOD-09-T06 (roadmap §4h.4 API-129; owner decision D-R48) as
// pure rules, unit-tested in my-grades.policy.spec.ts. Ownership as «my
// lessons» (`ownedEnrollmentsWhere()` of lessons/my-lessons.policy.ts), and the
// dedicated keys of 7.2 on top of it: an owned enrollment of the caller (`self`)
// needs `grades.read_own`, a child's (`child`, while the caller holds the
// `guardian` role) needs `grades.read_linked` — so a custom role can withhold
// grades. A caller with neither key is refused (403); one key alone shows its
// relation only. Learners see the components without drafts and an exam only
// once its results are published, and the final grade once fixed — no running
// average (D-R48).
import type { MyClassRelation } from '../enrollments/my-classes.policy.js';

export const READ_OWN_GRADES_PERMISSION = 'grades.read_own';
export const READ_LINKED_GRADES_PERMISSION = 'grades.read_linked';
export const MY_GRADES_PERMISSIONS = [READ_OWN_GRADES_PERMISSION, READ_LINKED_GRADES_PERMISSION] as const;

export interface MyGradesAccess {
  self: boolean;
  child: boolean;
}

export function myGradesAccess(permissions: readonly string[]): MyGradesAccess {
  return { self: permissions.includes(READ_OWN_GRADES_PERMISSION), child: permissions.includes(READ_LINKED_GRADES_PERMISSION) };
}

/** The keys to report in `permission_denied` when the caller holds neither, else null. */
export function myGradesMissing(permissions: readonly string[]): string[] | null {
  const access = myGradesAccess(permissions);
  return access.self || access.child ? null : [...MY_GRADES_PERMISSIONS];
}

/** True when the caller's keys open this relation. */
export function opensRelation(access: MyGradesAccess, relation: MyClassRelation): boolean {
  return relation === 'self' ? access.self : access.child;
}
