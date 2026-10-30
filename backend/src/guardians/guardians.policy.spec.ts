import { describe, expect, it } from 'vitest';
import { holdsRole, isEmptyLinkPatch, planLinkUpdate } from './guardians.policy.js';

const withRoles = (...keys: string[]) => ({ roles: keys.map((key) => ({ role: { key } })) });

describe('guardians.policy — role checks (MOD-03-T09 AC 1)', () => {
  it('reads the actual role rows, not the profile', () => {
    expect(holdsRole(withRoles('guardian'), 'guardian')).toBe(true);
    expect(holdsRole(withRoles('student', 'teacher'), 'student')).toBe(true);
    expect(holdsRole(withRoles('student'), 'guardian')).toBe(false);
    expect(holdsRole(withRoles(), 'student')).toBe(false);
  });
});

describe('guardians.policy — PATCH diff (AC 3)', () => {
  const current = { relationship: 'mother', isPrimary: false } as const;

  it('treats an empty patch as nothing to update', () => {
    expect(isEmptyLinkPatch({})).toBe(true);
    expect(isEmptyLinkPatch({ relationship: undefined, isPrimary: undefined })).toBe(true);
    expect(isEmptyLinkPatch({ isPrimary: false })).toBe(false);
  });

  it('writes nothing when the values are unchanged (idempotent PATCH)', () => {
    expect(planLinkUpdate(current, { relationship: 'mother', isPrimary: false })).toEqual({ fields: [], data: {}, promote: false });
  });

  it('writes only the fields that differ, in a fixed order', () => {
    expect(planLinkUpdate(current, { relationship: 'legal_guardian' })).toEqual({
      fields: ['relationship'],
      data: { relationship: 'legal_guardian' },
      promote: false,
    });
    expect(planLinkUpdate(current, { isPrimary: true, relationship: 'father' })).toEqual({
      fields: ['relationship', 'isPrimary'],
      data: { relationship: 'father', isPrimary: true },
      promote: true,
    });
  });

  it('flags a promotion only when the link becomes primary', () => {
    expect(planLinkUpdate(current, { isPrimary: true }).promote).toBe(true);
    expect(planLinkUpdate({ ...current, isPrimary: true }, { isPrimary: true }).promote).toBe(false);
    expect(planLinkUpdate({ ...current, isPrimary: true }, { isPrimary: false })).toEqual({
      fields: ['isPrimary'],
      data: { isPrimary: false },
      promote: false,
    });
  });
});
