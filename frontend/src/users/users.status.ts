// Account state machine of MOD-03-T06 mirrored for the drawer (MOD-03-T14), so
// the status menu offers only what the server would accept. Pure functions —
// mirror of backend/src/users/users.status.ts; the server stays the authority.
//
//   activate  pending | suspended → active
//   suspend   active → suspended            (signs out every device)
//   archive   active | suspended → archived (signs out every device)
//   restore   archived → active
//   unlock    active → active               (clears the login lock only)
//   delete    any non-deleted state → archived + deletedAt (API-028; signs out every device)
//
// A soft-deleted account is the terminal pseudo-state `deleted`: nothing
// applies to it (ADR-035). An `invited` account is activated by accepting its
// invitation, never by `activate`.
import type { UserStatus, UserStatusAction, UserSummary } from '../api/users'

/** Every state-changing operation of the menu, the soft delete of API-028 included. */
export type AccountAction = UserStatusAction | 'delete'

/** The status of a live account, or `deleted` for a soft-deleted one. */
export type AccountState = UserStatus | 'deleted'

export const ACCOUNT_ACTIONS = ['activate', 'suspend', 'archive', 'restore', 'unlock', 'delete'] as const satisfies readonly AccountAction[]

export const DEACTIVATE_USERS_PERMISSION = 'users.deactivate'
/** `unlock` is an everyday support task: `users.update` suffices (API-027). */
export const UNLOCK_USERS_PERMISSION = 'users.update'

const TRANSITIONS: Readonly<Record<AccountAction, Partial<Readonly<Record<AccountState, UserStatus>>>>> = {
  activate: { pending: 'active', suspended: 'active' },
  suspend: { active: 'suspended' },
  archive: { active: 'archived', suspended: 'archived' },
  restore: { archived: 'active' },
  unlock: { active: 'active' },
  delete: { invited: 'archived', pending: 'archived', active: 'archived', suspended: 'archived', archived: 'archived' },
}

/** Actions that take the account out of service: they revoke every session and are refused on oneself. */
const SIGNS_OUT: ReadonlySet<AccountAction> = new Set<AccountAction>(['suspend', 'archive', 'delete'])

export function accountStateOf(user: Pick<UserSummary, 'status' | 'deletedAt'>): AccountState {
  return user.deletedAt ? 'deleted' : user.status
}

/** The status the action leads to from `from`, or null when the transition is not allowed. */
export function nextStatus(action: AccountAction, from: AccountState): UserStatus | null {
  return TRANSITIONS[action][from] ?? null
}

/** Actions allowed from a state, in catalogue order (what `409 invalid_transition` lists as `allowed`). */
export function allowedActions(from: AccountState): AccountAction[] {
  return ACCOUNT_ACTIONS.filter((action) => TRANSITIONS[action][from] !== undefined)
}

/** `suspend`, `archive` and `delete` end every session of the user — the confirmation says so and the button is red. */
export function signsOut(action: AccountAction): boolean {
  return SIGNS_OUT.has(action)
}

/** Nobody takes away their own access: the server answers `403 self_forbidden` (API-027/API-028). */
export function isSelfForbidden(action: AccountAction): boolean {
  return SIGNS_OUT.has(action)
}

/** `users.deactivate` allows everything; `users.update` alone allows `unlock` only. */
export function isActionPermitted(action: AccountAction, permissions: readonly string[]): boolean {
  if (permissions.includes(DEACTIVATE_USERS_PERMISSION)) return true
  return action === 'unlock' && permissions.includes(UNLOCK_USERS_PERMISSION)
}

export interface AccountActionContext {
  /** Permission keys of the signed-in user. */
  permissions: readonly string[]
  /** Id of the signed-in user; the actions that sign out are never offered on oneself. */
  selfId: string | null
  /**
   * Whether `lockedUntil` is visible to the caller (`users.read_contact`). Without
   * it the lock state is unknown and `unlock` stays offered (a no-op is harmless
   * — the server answers 200 without an event).
   */
  contact: boolean
}

/**
 * The actions the menu offers for this account: allowed by the state machine,
 * permitted for the caller, not self-destructive, and `unlock` only when the
 * account is known (or might be) locked.
 */
export function availableAccountActions(
  user: Pick<UserSummary, 'id' | 'status' | 'deletedAt' | 'lockedUntil'>,
  context: AccountActionContext,
): AccountAction[] {
  const state = accountStateOf(user)
  const self = context.selfId !== null && context.selfId === user.id
  return allowedActions(state).filter((action) => {
    if (!isActionPermitted(action, context.permissions)) return false
    if (self && isSelfForbidden(action)) return false
    if (action === 'unlock' && context.contact && user.lockedUntil === null) return false
    return true
  })
}
