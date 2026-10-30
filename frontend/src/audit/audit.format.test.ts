import { describe, expect, it } from 'vitest'
import { actionFamily, familyColor, metadataSummary, metadataText, shortId } from './audit.format'

describe('audit.format', () => {
  it('derives the family and its colour from the event name', () => {
    expect(actionFamily('users.status.changed')).toBe('users')
    expect(actionFamily('auth.logout')).toBe('auth')
    expect(familyColor('roles.created')).toBe('geekblue')
    expect(familyColor('guardians.linked')).toBe('cyan')
    expect(familyColor('courses.created')).toBe('default')
  })

  it('shortens UUIDs to their first block and long identifiers to 12 characters', () => {
    expect(shortId('0192f0a0-0000-7000-8000-000000000002')).toBe('0192f0a0…')
    expect(shortId('S-2026-001')).toBe('S-2026-001')
    expect(shortId('a-very-long-reference-number')).toBe('a-very-long-…')
  })

  it('pretty-prints metadata and treats null, undefined and {} as none', () => {
    expect(metadataText(null)).toBeNull()
    expect(metadataText(undefined)).toBeNull()
    expect(metadataText({})).toBeNull()
    expect(metadataText({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('summarises scalar metadata in key order and caps the entries', () => {
    expect(metadataSummary({ action: 'suspend', from: 'active', to: 'suspended', reason: null, revokedSessions: 2 })).toBe('action: suspend · from: active · to: suspended · revokedSessions: 2')
    expect(metadataSummary({ a: 1, b: 2, c: 3, d: 4, e: 5 })).toBe('a: 1 · b: 2 · c: 3 · d: 4 · …')
    expect(metadataSummary({ roles: ['teacher'], fields: ['email'] })).toBeNull()
    expect(metadataSummary(null)).toBeNull()
    expect(metadataSummary(['x'])).toBeNull()
  })
})
