// TEST-030 (unit part) — audit-log filters and keyset pagination (MOD-03-T10).
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION_PATTERN, ENTITY_TYPE_PATTERN, UUID_PATTERN, buildAuditWhere, pageOf } from './audit.query.js';

const ACTOR = '018f6b2a-7c3e-7000-8000-000000000001';
const CURSOR = '018f6b2a-7c3e-7000-8000-00000000abcd';

describe('buildAuditWhere()', () => {
  it('returns an empty filter when nothing is given', () => {
    expect(buildAuditWhere({})).toEqual({});
  });

  it('matches the action prefix literally — `_` and `%` are escaped for LIKE (KI-034)', () => {
    expect(buildAuditWhere({ action: 'users.' })).toEqual({ action: { startsWith: 'users.' } });
    expect(buildAuditWhere({ action: 'auth.logout_' })).toEqual({ action: { startsWith: 'auth.logout\\_' } });
    expect(buildAuditWhere({ action: 'a%b' })).toEqual({ action: { startsWith: 'a\\%b' } });
  });

  it('ANDs actor, entity, time bound and cursor', () => {
    expect(
      buildAuditWhere({
        action: 'roles.',
        actorUserId: ACTOR,
        entityType: 'roles',
        entityId: 'r-1',
        before: '2026-10-30T10:00:00.000Z',
        cursor: CURSOR,
      }),
    ).toEqual({
      action: { startsWith: 'roles.' },
      actorUserId: ACTOR,
      entityType: 'roles',
      entityId: 'r-1',
      createdAt: { lt: new Date('2026-10-30T10:00:00.000Z') },
      id: { lt: CURSOR },
    });
  });
});

describe('pageOf()', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${n - i}` }));

  it('hands out the id of the last item as cursor only when an extra row proved an older page', () => {
    expect(pageOf(rows(4), 3)).toEqual({ items: [{ id: 'id-4' }, { id: 'id-3' }, { id: 'id-2' }], nextCursor: 'id-2' });
    expect(pageOf(rows(3), 3)).toEqual({ items: rows(3), nextCursor: null });
    expect(pageOf(rows(1), 3)).toEqual({ items: [{ id: 'id-1' }], nextCursor: null });
    expect(pageOf([], 3)).toEqual({ items: [], nextCursor: null });
  });
});

describe('query patterns', () => {
  it('accept dotted lower-case event prefixes and table-like entity types, reject the rest', () => {
    for (const ok of ['users.', 'users.status.changed', 'auth.logout_all', 'a']) expect(AUDIT_ACTION_PATTERN.test(ok)).toBe(true);
    for (const bad of ['', 'Users.', '.users', '1users', 'users%', 'users ', 'a'.repeat(65)]) {
      expect(AUDIT_ACTION_PATTERN.test(bad), bad).toBe(false);
    }
    for (const ok of ['users', 'roles', 'student_profiles']) expect(ENTITY_TYPE_PATTERN.test(ok)).toBe(true);
    for (const bad of ['', 'Users', 'users.', 'users-1']) expect(ENTITY_TYPE_PATTERN.test(bad), bad).toBe(false);
    expect(UUID_PATTERN.test(CURSOR)).toBe(true);
    expect(UUID_PATTERN.test(CURSOR.toUpperCase())).toBe(true);
    expect(UUID_PATTERN.test('garbage')).toBe(false);
  });
});
