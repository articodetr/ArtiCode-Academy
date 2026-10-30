// Rules of guardian ↔ student links (MOD-03-T09) as pure functions, unit-tested
// in guardians.policy.spec.ts without a database. The service loads the two
// users, their roles and the current link; these functions decide.
//
//   the guardian must hold the `guardian` role, the student the `student` role
//     (actual rows of user_roles, never the profiles)
//   a PATCH is a diff: only fields whose value changes are written
//   promoting a guardian to primary demotes the student's current primary
//     guardian in the same transaction (uq_guardian_students_primary)
import type { GuardianRelationship } from '../generated/prisma/client.js';

/** Creating, changing and removing links. Reading them is part of reading users. */
export const LINK_GUARDIANS_PERMISSION = 'guardians.link';
export const READ_GUARDIANS_PERMISSION = 'users.read';

export const GUARDIAN_ROLE_KEY = 'guardian';
export const STUDENT_ROLE_KEY = 'student';

/** Role grants as the services select them (`roles: { select: { role: { select: { key } } } }`). */
export interface RoleKeyGrants {
  roles: readonly { role: { key: string } }[];
}

export function holdsRole(user: RoleKeyGrants, key: string): boolean {
  return user.roles.some((grant) => grant.role.key === key);
}

export interface LinkState {
  relationship: GuardianRelationship;
  isPrimary: boolean;
}

export interface LinkPatch {
  relationship?: GuardianRelationship;
  isPrimary?: boolean;
}

export type LinkField = keyof LinkState;

export interface LinkUpdatePlan {
  /** Fields whose value changes, in a fixed order (the audit metadata names them). */
  fields: LinkField[];
  /** What to write; empty when nothing differs. */
  data: Partial<LinkState>;
  /** True when the link becomes primary: the current primary guardian must be demoted first. */
  promote: boolean;
}

/** `{}` (or only undefined fields) carries nothing to update. */
export function isEmptyLinkPatch(patch: LinkPatch): boolean {
  return patch.relationship === undefined && patch.isPrimary === undefined;
}

/** Pure diff of a PATCH against the current link. */
export function planLinkUpdate(current: LinkState, patch: LinkPatch): LinkUpdatePlan {
  const fields: LinkField[] = [];
  const data: Partial<LinkState> = {};
  if (patch.relationship !== undefined && patch.relationship !== current.relationship) {
    data.relationship = patch.relationship;
    fields.push('relationship');
  }
  if (patch.isPrimary !== undefined && patch.isPrimary !== current.isPrimary) {
    data.isPrimary = patch.isPrimary;
    fields.push('isPrimary');
  }
  return { fields, data, promote: data.isPrimary === true };
}
