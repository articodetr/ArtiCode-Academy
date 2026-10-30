// TEST-025 — MOD-03-T08 role management policy (reserved keys, immutability, permission diff).
import { PERMISSION_KEYS } from '../authorization/permission-catalog.js';
import { SYSTEM_ROLE_KEYS } from '../authorization/system-roles.js';
import { diffPermissions, isReservedRoleKey, rolePatchImmutability, unknownPermissionKeys } from './roles.policy.js';

describe('roles management policy', () => {
  it('reserves every system role key and nothing else', () => {
    for (const key of SYSTEM_ROLE_KEYS) expect(isReservedRoleKey(key), key).toBe(true);
    expect(SYSTEM_ROLE_KEYS).toContain('academy_admin');
    expect(isReservedRoleKey('librarian')).toBe(false);
    expect(isReservedRoleKey('academy_admin2')).toBe(false);
    expect(isReservedRoleKey('')).toBe(false);
  });

  it('refuses every change to academy_admin and metadata changes to the other system roles', () => {
    const admin = { key: 'academy_admin', isSystem: true };
    expect(rolePatchImmutability(admin, { permissions: [] })).toEqual({ kind: 'immutable', key: 'academy_admin' });
    expect(rolePatchImmutability(admin, { label: { ar: 'x' } })).toEqual({ kind: 'immutable', key: 'academy_admin' });
    expect(rolePatchImmutability(admin, {})).toEqual({ kind: 'immutable', key: 'academy_admin' });

    const teacher = { key: 'teacher', isSystem: true };
    expect(rolePatchImmutability(teacher, { permissions: ['users.read'] })).toBeNull();
    expect(rolePatchImmutability(teacher, { label: { ar: 'x' } })).toEqual({
      kind: 'fields_immutable',
      key: 'teacher',
      fields: ['label'],
    });
    expect(rolePatchImmutability(teacher, { description: null, permissions: [] })).toEqual({
      kind: 'fields_immutable',
      key: 'teacher',
      fields: ['description'],
    });
    expect(rolePatchImmutability(teacher, { label: { ar: 'x' }, description: { ar: 'y' } })).toEqual({
      kind: 'fields_immutable',
      key: 'teacher',
      fields: ['label', 'description'],
    });

    // A custom role (even one named like an admin) accepts everything.
    const custom = { key: 'academy_admin_assistant', isSystem: false };
    expect(rolePatchImmutability(custom, { label: { ar: 'x' }, description: null, permissions: [] })).toBeNull();
  });

  it('diffs the permission set as a full replacement, sorted and without duplicates', () => {
    expect(diffPermissions(['a', 'b'], ['a', 'b'])).toEqual({ added: [], removed: [] });
    expect(diffPermissions([], [])).toEqual({ added: [], removed: [] });
    expect(diffPermissions(['users.read', 'courses.read'], ['courses.read', 'audit.read', 'audit.read'])).toEqual({
      added: ['audit.read'],
      removed: ['users.read'],
    });
    // Deprecated grants the caller cannot see are still removed by a replacement.
    expect(diffPermissions(['users.read', 'legacy.key'], ['users.read'])).toEqual({ added: [], removed: ['legacy.key'] });
    expect(diffPermissions(['b', 'a'], [])).toEqual({ added: [], removed: ['a', 'b'] });
    expect(diffPermissions([], ['b', 'a', 'b'])).toEqual({ added: ['a', 'b'], removed: [] });
  });

  it('reports unknown and deprecated keys against the active catalog', () => {
    const active = new Set(PERMISSION_KEYS);
    expect(unknownPermissionKeys(['users.read', 'roles.manage'], active)).toEqual([]);
    expect(unknownPermissionKeys(['users.read', 'nope.key', 'zzz.key', 'nope.key'], active)).toEqual(['nope.key', 'zzz.key']);
    // A key that left the active set (deprecated) counts as unknown.
    const withoutAudit = new Set([...PERMISSION_KEYS].filter((key) => key !== 'audit.read'));
    expect(unknownPermissionKeys(['audit.read'], withoutAudit)).toEqual(['audit.read']);
    expect(unknownPermissionKeys([], active)).toEqual([]);
  });
});
