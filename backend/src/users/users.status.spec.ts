// Unit tests of the account state machine (MOD-03-T06) — no database.
import { describe, expect, it } from 'vitest';
import type { UserStatus } from '../generated/prisma/client.js';
import {
  USER_STATUS_ACTIONS,
  accountState,
  allowedActions,
  isSelfForbidden,
  missingPermissionFor,
  nextStatus,
  removesActiveAccount,
  requiredPermissionFor,
  revokesSessions,
} from './users.status.js';
import type { AccountAction, AccountState } from './users.status.js';

const STATES: readonly AccountState[] = ['invited', 'pending', 'active', 'suspended', 'archived', 'deleted'];
const ACTIONS: readonly AccountAction[] = [...USER_STATUS_ACTIONS, 'delete'];

describe('users.status — transitions (T06 AC 1)', () => {
  it('allows exactly the transitions of the roadmap', () => {
    const allowed: Array<[AccountAction, AccountState, UserStatus]> = [
      ['activate', 'pending', 'active'],
      ['activate', 'suspended', 'active'],
      ['suspend', 'active', 'suspended'],
      ['archive', 'active', 'archived'],
      ['archive', 'suspended', 'archived'],
      ['restore', 'archived', 'active'],
      ['unlock', 'active', 'active'],
      ['delete', 'invited', 'archived'],
      ['delete', 'pending', 'archived'],
      ['delete', 'active', 'archived'],
      ['delete', 'suspended', 'archived'],
      ['delete', 'archived', 'archived'],
    ];
    const allowedKeys = new Set(allowed.map(([action, from]) => `${action}:${from}`));
    for (const [action, from, to] of allowed) expect(nextStatus(action, from), `${action} from ${from}`).toBe(to);
    for (const action of ACTIONS) {
      for (const from of STATES) {
        if (!allowedKeys.has(`${action}:${from}`)) expect(nextStatus(action, from), `${action} from ${from}`).toBeNull();
      }
    }
  });

  it('refuses every action on a soft-deleted account and activate on an invited one', () => {
    for (const action of ACTIONS) expect(nextStatus(action, 'deleted'), action).toBeNull();
    expect(allowedActions('deleted')).toEqual([]);
    expect(nextStatus('activate', 'invited')).toBeNull();
    expect(nextStatus('activate', 'active')).toBeNull();
    expect(nextStatus('restore', 'suspended')).toBeNull();
  });

  it('lists the allowed actions per state in catalogue order', () => {
    expect(allowedActions('invited')).toEqual(['delete']);
    expect(allowedActions('pending')).toEqual(['activate', 'delete']);
    expect(allowedActions('active')).toEqual(['suspend', 'archive', 'unlock', 'delete']);
    expect(allowedActions('suspended')).toEqual(['activate', 'archive', 'delete']);
    expect(allowedActions('archived')).toEqual(['restore', 'delete']);
  });

  it('derives the state from the status and the soft-delete marker', () => {
    expect(accountState({ status: 'active', deletedAt: null })).toBe('active');
    expect(accountState({ status: 'archived', deletedAt: new Date() })).toBe('deleted');
    expect(accountState({ status: 'active', deletedAt: new Date() })).toBe('deleted');
  });
});

describe('users.status — side rules (T06 AC 2, AC 3, AC 4)', () => {
  it('signs the account out on suspend, archive and delete only', () => {
    expect(ACTIONS.filter(revokesSessions)).toEqual(['suspend', 'archive', 'delete']);
  });

  it('forbids taking away one’s own access, and nothing else', () => {
    expect(ACTIONS.filter(isSelfForbidden)).toEqual(['suspend', 'archive', 'delete']);
  });

  it('applies the last-admin rule only when an active account is taken out of service', () => {
    expect(removesActiveAccount('suspend', 'active')).toBe(true);
    expect(removesActiveAccount('archive', 'active')).toBe(true);
    expect(removesActiveAccount('delete', 'active')).toBe(true);
    expect(removesActiveAccount('archive', 'suspended')).toBe(false);
    expect(removesActiveAccount('delete', 'suspended')).toBe(false);
    expect(removesActiveAccount('delete', 'archived')).toBe(false);
    expect(removesActiveAccount('unlock', 'active')).toBe(false);
    expect(removesActiveAccount('activate', 'suspended')).toBe(false);
    expect(removesActiveAccount('restore', 'archived')).toBe(false);
  });

  it('needs users.deactivate for everything but unlock, which users.update also covers', () => {
    for (const action of ACTIONS) {
      expect(requiredPermissionFor(action)).toBe(action === 'unlock' ? 'users.update' : 'users.deactivate');
      expect(missingPermissionFor(action, ['users.deactivate'])).toBeNull();
      expect(missingPermissionFor(action, ['users.read', 'users.update'])).toBe(action === 'unlock' ? null : 'users.deactivate');
      expect(missingPermissionFor(action, ['users.read'])).toBe(action === 'unlock' ? 'users.update' : 'users.deactivate');
      expect(missingPermissionFor(action, [])).toBe(requiredPermissionFor(action));
    }
  });
});
