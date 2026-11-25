import { describe, expect, it } from 'vitest'
import { makeUserDetail } from '../test/users'
import {
  ACCOUNT_ACTIONS,
  accountStateOf,
  allowedActions,
  availableAccountActions,
  canResetMfa,
  canUnlinkGoogle,
  isActionPermitted,
  nextStatus,
  signsOut,
} from './users.status'
import type { AccountAction } from './users.status'

const ADMIN = ['users.read', 'users.deactivate']
const SUPPORT = ['users.read', 'users.update']

describe('account state machine (mirror of users.status.ts)', () => {
  it('reads the deleted pseudo-state from deletedAt and lists the allowed actions in catalogue order', () => {
    expect(accountStateOf({ status: 'active', deletedAt: null })).toBe('active')
    expect(accountStateOf({ status: 'archived', deletedAt: '2026-10-30T10:00:00.000Z' })).toBe('deleted')
    expect(allowedActions('active')).toEqual(['suspend', 'archive', 'unlock', 'delete'])
    expect(allowedActions('suspended')).toEqual(['activate', 'archive', 'delete'])
    expect(allowedActions('archived')).toEqual(['restore', 'delete'])
    expect(allowedActions('pending')).toEqual(['activate', 'delete'])
    expect(allowedActions('invited')).toEqual(['delete'])
    expect(allowedActions('deleted')).toEqual([])
  })

  it('knows the target status of every transition and which actions sign the user out', () => {
    expect(nextStatus('suspend', 'active')).toBe('suspended')
    expect(nextStatus('restore', 'archived')).toBe('active')
    expect(nextStatus('activate', 'invited')).toBeNull()
    expect(nextStatus('delete', 'suspended')).toBe('archived')
    const signingOut: AccountAction[] = ['suspend', 'archive', 'delete']
    expect(signingOut.every((action) => signsOut(action))).toBe(true)
    expect(signsOut('unlock')).toBe(false)
    expect(signsOut('activate')).toBe(false)
  })

  it('permits everything with users.deactivate and only unlock with users.update', () => {
    expect(isActionPermitted('delete', ADMIN)).toBe(true)
    expect(isActionPermitted('unlock', SUPPORT)).toBe(true)
    expect(isActionPermitted('suspend', SUPPORT)).toBe(false)
    expect(isActionPermitted('unlock', ['users.read'])).toBe(false)
  })
})

describe('availableAccountActions', () => {
  it('offers the state transitions the caller may perform, hiding unlock when the account is visibly unlocked', () => {
    const active = makeUserDetail({ status: 'active' })
    expect(availableAccountActions(active, { permissions: ADMIN, selfId: 'me', contact: true })).toEqual(['suspend', 'archive', 'delete'])
    expect(availableAccountActions({ ...active, lockedUntil: '2026-10-30T12:00:00.000Z' }, { permissions: ADMIN, selfId: 'me', contact: true })).toEqual([
      'suspend',
      'archive',
      'unlock',
      'delete',
    ])
    // Without users.read_contact the lock is invisible: unlock stays offered (a no-op is harmless).
    expect(availableAccountActions(active, { permissions: SUPPORT, selfId: 'me', contact: false })).toEqual(['unlock'])
    expect(availableAccountActions(active, { permissions: SUPPORT, selfId: 'me', contact: true })).toEqual([])
  })

  it('never offers suspend, archive or delete on the signed-in user, and nothing on a deleted account', () => {
    const me = makeUserDetail({ status: 'active', lockedUntil: '2026-10-30T12:00:00.000Z' })
    expect(availableAccountActions(me, { permissions: ADMIN, selfId: me.id, contact: true })).toEqual(['unlock'])
    const gone = makeUserDetail({ status: 'archived', deletedAt: '2026-10-30T10:00:00.000Z' })
    expect(availableAccountActions(gone, { permissions: ADMIN, selfId: 'me', contact: true })).toEqual([])
    expect(availableAccountActions(makeUserDetail({ status: 'invited' }), { permissions: ADMIN, selfId: 'me', contact: true })).toEqual(['delete'])
  })

  it('hides «activate» on a self-registration awaiting its owner — the server answers 409 { allowed: [delete] } — and keeps every other rule', () => {
    const awaiting = makeUserDetail({ status: 'pending', awaitingRegistration: true })
    expect(availableAccountActions(awaiting, { permissions: ADMIN, selfId: 'me', contact: true })).toEqual(['delete'])
    // A pending account approved by the office keeps «activate».
    const approval = makeUserDetail({ status: 'pending', awaitingRegistration: false })
    expect(availableAccountActions(approval, { permissions: ADMIN, selfId: 'me', contact: true })).toEqual(['activate', 'delete'])
    // A detail from an older server (no field) keeps the plain rule.
    const { awaitingRegistration: _absent, ...older } = approval
    expect(availableAccountActions(older, { permissions: ADMIN, selfId: 'me', contact: true })).toEqual(['activate', 'delete'])
    // The flag touches «activate» only: the other states and rules are unchanged.
    const suspended = makeUserDetail({ status: 'suspended', awaitingRegistration: true })
    expect(availableAccountActions(suspended, { permissions: ADMIN, selfId: 'me', contact: true })).toEqual(['archive', 'delete'])
    expect(allowedActions('pending')).toEqual(['activate', 'delete'])
  })
})

describe('canResetMfa (API-212 — beside the state machine, not part of it)', () => {
  const ON = '2026-11-01T08:00:00.000Z'

  it('offers the reset only with users.update, on somebody else, while two-step verification is visibly on', () => {
    const user = makeUserDetail({ status: 'active', mfaEnabledAt: ON })
    expect(canResetMfa(user, { permissions: SUPPORT, selfId: 'me' })).toBe(true)
    expect(canResetMfa(user, { permissions: SUPPORT, selfId: null })).toBe(true)
    // users.deactivate does not replace users.update here (unlike the status actions).
    expect(canResetMfa(user, { permissions: ADMIN, selfId: 'me' })).toBe(false)
    expect(canResetMfa(user, { permissions: ['users.read'], selfId: 'me' })).toBe(false)
    // One's own second step is turned off from «my account»: the server answers self_forbidden.
    expect(canResetMfa(user, { permissions: SUPPORT, selfId: user.id })).toBe(false)
    // Off — or unknown: the server sends null to a caller without users.read_contact.
    expect(canResetMfa({ ...user, mfaEnabledAt: null }, { permissions: SUPPORT, selfId: 'me' })).toBe(false)
  })

  it('offers nothing when the detail carries no mfaEnabledAt at all (the drawer row reads the same truthiness)', () => {
    const { mfaEnabledAt: _absent, ...withoutField } = makeUserDetail({ status: 'active', mfaEnabledAt: ON })
    // What an answer without the field looks like at run time; the type says it is always there.
    const older = withoutField as unknown as Parameters<typeof canResetMfa>[0]
    expect(older.mfaEnabledAt).toBeUndefined()
    expect(canResetMfa(older, { permissions: SUPPORT, selfId: 'me' })).toBe(false)
    expect(canResetMfa({ ...withoutField, mfaEnabledAt: '' }, { permissions: SUPPORT, selfId: 'me' })).toBe(false)
  })

  it('follows the second step, not the status: any live account, never a soft-deleted one', () => {
    for (const status of ['invited', 'pending', 'active', 'suspended', 'archived'] as const) {
      expect(canResetMfa(makeUserDetail({ status, mfaEnabledAt: ON }), { permissions: SUPPORT, selfId: 'me' })).toBe(true)
    }
    const gone = makeUserDetail({ status: 'archived', deletedAt: '2026-10-30T10:00:00.000Z', mfaEnabledAt: ON })
    expect(canResetMfa(gone, { permissions: SUPPORT, selfId: 'me' })).toBe(false)
  })

  it('stays out of the mirrored state machine', () => {
    expect(ACCOUNT_ACTIONS).toEqual(['activate', 'suspend', 'archive', 'restore', 'unlock', 'delete'])
    const withMfa = makeUserDetail({ status: 'active', mfaEnabledAt: ON })
    expect(availableAccountActions(withMfa, { permissions: [...ADMIN, 'users.update'], selfId: 'me', contact: true })).toEqual(['suspend', 'archive', 'delete'])
  })
})

describe('canUnlinkGoogle (DELETE /api/users/:id/google-identity — beside the state machine, not part of it)', () => {
  const LINKED = '2026-11-20T08:00:00.000Z'

  it('offers the unlink with users.update while a Google account is visibly linked, on oneself too', () => {
    const user = makeUserDetail({ status: 'active', googleLinkedAt: LINKED })
    expect(canUnlinkGoogle(user, { permissions: SUPPORT })).toBe(true)
    // users.deactivate does not replace users.update here.
    expect(canUnlinkGoogle(user, { permissions: ADMIN })).toBe(false)
    expect(canUnlinkGoogle(user, { permissions: ['users.read'] })).toBe(false)
    // None linked — or unknown: the server sends null to a caller without users.read_contact.
    expect(canUnlinkGoogle({ ...user, googleLinkedAt: null }, { permissions: SUPPORT })).toBe(false)
    const { googleLinkedAt: _absent, ...older } = user
    expect(canUnlinkGoogle(older, { permissions: SUPPORT })).toBe(false)
  })

  it('offers nothing on a soft-deleted account, and stays out of the mirrored state machine', () => {
    const gone = makeUserDetail({ status: 'archived', deletedAt: '2026-10-30T10:00:00.000Z', googleLinkedAt: LINKED })
    expect(canUnlinkGoogle(gone, { permissions: SUPPORT })).toBe(false)
    const linked = makeUserDetail({ status: 'active', googleLinkedAt: LINKED })
    expect(availableAccountActions(linked, { permissions: [...ADMIN, 'users.update'], selfId: 'me', contact: true })).toEqual(['suspend', 'archive', 'delete'])
  })
})
