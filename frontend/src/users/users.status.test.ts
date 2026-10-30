import { describe, expect, it } from 'vitest'
import { makeUserDetail } from '../test/users'
import { accountStateOf, allowedActions, availableAccountActions, isActionPermitted, nextStatus, signsOut } from './users.status'
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
})
