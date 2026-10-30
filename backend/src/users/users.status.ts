// Account state machine of MOD-03-T06 as pure functions, so the rules can be
// unit-tested without a database (users.status.spec.ts). The service loads
// the account and the caller; these functions decide.
//
//   activate  pending | suspended → active
//   suspend   active → suspended            (signs out every device)
//   archive   active | suspended → archived (signs out every device)
//   restore   archived → active
//   unlock    active → active               (clears the login lock only)
//   delete    any non-deleted state → archived + deleted_at (API-028; signs out every device)
//
// A soft-deleted account is a terminal pseudo-state (`deleted`): no action
// applies to it, not even `restore` (ADR-035). An `invited` account is
// activated by accepting its invitation (MOD-03-T03), never by `activate`.
import type { UserStatus } from '../generated/prisma/client.js';

/** Actions of `POST /api/users/:id/status` (API-027). */
export const USER_STATUS_ACTIONS = ['activate', 'suspend', 'archive', 'restore', 'unlock'] as const;
export type UserStatusAction = (typeof USER_STATUS_ACTIONS)[number];

/** Every state-changing operation of T06, the soft delete of API-028 included. */
export type AccountAction = UserStatusAction | 'delete';

/** The status of a live account, or `deleted` for a soft-deleted one. */
export type AccountState = UserStatus | 'deleted';

export const DEACTIVATE_USERS_PERMISSION = 'users.deactivate';
export const UNLOCK_USERS_PERMISSION = 'users.update';

const TRANSITIONS: Readonly<Record<AccountAction, Partial<Readonly<Record<AccountState, UserStatus>>>>> = {
  activate: { pending: 'active', suspended: 'active' },
  suspend: { active: 'suspended' },
  archive: { active: 'archived', suspended: 'archived' },
  restore: { archived: 'active' },
  unlock: { active: 'active' },
  delete: { invited: 'archived', pending: 'archived', active: 'archived', suspended: 'archived', archived: 'archived' },
};

const ACTIONS = Object.keys(TRANSITIONS) as readonly AccountAction[];

/** Actions that take the account out of service and therefore revoke every refresh token. */
const SIGNS_OUT: ReadonlySet<AccountAction> = new Set<AccountAction>(['suspend', 'archive', 'delete']);

export function accountState(user: { status: UserStatus; deletedAt: Date | null }): AccountState {
  return user.deletedAt === null ? user.status : 'deleted';
}

/** The status the action leads to from `from`, or null when the transition is not allowed. */
export function nextStatus(action: AccountAction, from: AccountState): UserStatus | null {
  return TRANSITIONS[action][from] ?? null;
}

/** Actions allowed from a state, in catalogue order (the `allowed` detail of `invalid_transition`). */
export function allowedActions(from: AccountState): AccountAction[] {
  return ACTIONS.filter((action) => TRANSITIONS[action][from] !== undefined);
}

/** `suspend`, `archive` and `delete` sign the user out of every device (`refresh_tokens.revoked_at`). */
export function revokesSessions(action: AccountAction): boolean {
  return SIGNS_OUT.has(action);
}

/**
 * Nobody may take away their own access (AC 2): the actions that sign the
 * account out are refused on oneself. `unlock` on oneself is harmless and
 * allowed; `activate`/`restore` on oneself are unreachable (a caller with a
 * session is `active`) and end as `invalid_transition`.
 */
export function isSelfForbidden(action: AccountAction): boolean {
  return SIGNS_OUT.has(action);
}

/**
 * Whether the action takes an `active` account out of service — when the
 * target holds `academy_admin`, the last-admin rule applies (AC 3). Archiving
 * or deleting an already suspended admin changes nothing about the quorum.
 */
export function removesActiveAccount(action: AccountAction, from: AccountState): boolean {
  return from === 'active' && SIGNS_OUT.has(action);
}

/** `unlock` is an everyday support task (`users.update`); everything else needs `users.deactivate`. */
export function requiredPermissionFor(action: AccountAction): string {
  return action === 'unlock' ? UNLOCK_USERS_PERMISSION : DEACTIVATE_USERS_PERMISSION;
}

/**
 * Whether the caller may perform the action: `users.update` *or*
 * `users.deactivate` for `unlock`, `users.deactivate` for the rest. Returns
 * the permission to report as missing, or null when allowed.
 */
export function missingPermissionFor(action: AccountAction, callerPermissions: readonly string[]): string | null {
  if (callerPermissions.includes(DEACTIVATE_USERS_PERMISSION)) return null;
  if (action === 'unlock' && callerPermissions.includes(UNLOCK_USERS_PERMISSION)) return null;
  return requiredPermissionFor(action);
}
