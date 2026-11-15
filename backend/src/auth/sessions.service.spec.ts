// TEST-220 (MOD-01-H06): folding refresh-token rows into the caller's sessions.
import { describe, expect, it } from 'vitest';
import { familyDeadline } from './refresh-family.js';
import { buildSessionItems } from './sessions.service.js';
import type { SessionTokenRow } from './sessions.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_MS = 30 * DAY_MS;
const NOW = new Date('2026-11-15T12:00:00.000Z');

/** A UUIDv7 whose timestamp is `at` (fixed random bits — enough for a pure test). */
function familyAt(at: Date, tail = '0000000000a1'): string {
  const hex = at.getTime().toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-${tail}`;
}

let sequence = 0;
function row(familyId: string, createdAt: string, expiresAt: string, extra: Partial<SessionTokenRow> = {}): SessionTokenRow {
  sequence += 1;
  return {
    id: `019a0000-0000-7000-8000-${sequence.toString(16).padStart(12, '0')}`,
    familyId,
    createdAt: new Date(createdAt),
    expiresAt: new Date(expiresAt),
    userAgent: null,
    ipAddress: null,
    ...extra,
  };
}

const deadlineOf = (familyId: string) => familyDeadline(familyId, MAX_MS);

describe('buildSessionItems (TEST-220)', () => {
  it('builds one item per family with the start from its id, the newest token’s activity and client, newest activity first', () => {
    const older = familyAt(new Date('2026-11-10T08:00:00.000Z'));
    const newer = familyAt(new Date('2026-11-14T09:30:00.000Z'), '0000000000b2');
    const items = buildSessionItems({
      live: [
        row(older, '2026-11-15T11:00:00.000Z', '2026-11-22T11:00:00.000Z', { userAgent: 'UA older', ipAddress: '198.51.100.4' }),
        row(newer, '2026-11-15T11:30:00.000Z', '2026-11-22T11:30:00.000Z', { userAgent: 'UA newer', ipAddress: '203.0.113.7' }),
      ],
      newer: [],
      deadlineOf,
      currentFamilyId: older,
      now: NOW,
    });
    expect(items).toEqual([
      {
        id: newer,
        startedAt: '2026-11-14T09:30:00.000Z',
        lastActiveAt: '2026-11-15T11:30:00.000Z',
        expiresAt: '2026-11-22T11:30:00.000Z',
        userAgent: 'UA newer',
        ipAddress: '203.0.113.7',
        current: false,
      },
      {
        id: older,
        startedAt: '2026-11-10T08:00:00.000Z',
        lastActiveAt: '2026-11-15T11:00:00.000Z',
        expiresAt: '2026-11-22T11:00:00.000Z',
        userAgent: 'UA older',
        ipAddress: '198.51.100.4',
        current: true,
      },
    ]);
    expect(items.flatMap((item) => Object.keys(item)).filter((key) => /hash|token|replaced/i.test(key))).toEqual([]);
  });

  it('caps the expiry at the family deadline and drops a family past it or without a UUIDv7 id', () => {
    const nearDeadline = familyAt(new Date(NOW.getTime() - MAX_MS + 2 * DAY_MS));
    const pastDeadline = familyAt(new Date(NOW.getTime() - MAX_MS - 1000), '0000000000c3');
    const items = buildSessionItems({
      live: [
        row(nearDeadline, '2026-11-15T10:00:00.000Z', '2026-11-22T10:00:00.000Z'),
        row(pastDeadline, '2026-11-15T10:00:00.000Z', '2026-11-22T10:00:00.000Z'),
        row('9b2f6a1e-4c3d-4f5a-8b6c-7d8e9f0a1b2c', '2026-11-15T10:00:00.000Z', '2026-11-22T10:00:00.000Z'),
      ],
      newer: [],
      deadlineOf,
      currentFamilyId: null,
      now: NOW,
    });
    expect(items.map((item) => item.id)).toEqual([nearDeadline]);
    expect(items[0]!.expiresAt).toBe(deadlineOf(nearDeadline)!.toISOString());
  });

  it('takes the newest token of a family, live or not, and the latest live expiry (two rotations that raced)', () => {
    const family = familyAt(new Date('2026-11-12T07:00:00.000Z'));
    const items = buildSessionItems({
      live: [
        row(family, '2026-11-15T09:00:00.000Z', '2026-11-22T09:00:00.000Z', { userAgent: 'first' }),
        row(family, '2026-11-15T09:00:00.000Z', '2026-11-22T09:05:00.000Z', { userAgent: 'second (same ms, later id)' }),
      ],
      newer: [
        row(family, '2026-11-15T09:10:00.000Z', '2026-11-22T09:10:00.000Z', { userAgent: 'revoked but newest', ipAddress: '192.0.2.1' }),
        row(familyAt(new Date('2026-11-01T00:00:00.000Z'), '0000000000d4'), '2026-11-15T11:59:00.000Z', '2026-11-22T11:59:00.000Z'),
      ],
      deadlineOf,
      currentFamilyId: null,
      now: NOW,
    });
    expect(items).toHaveLength(1); // a newer row alone never makes a family listed
    expect(items[0]).toMatchObject({
      id: family,
      lastActiveAt: '2026-11-15T09:10:00.000Z',
      userAgent: 'revoked but newest',
      ipAddress: '192.0.2.1',
      expiresAt: '2026-11-22T09:05:00.000Z',
      current: false,
    });

    const tie = buildSessionItems({
      live: [
        row(family, '2026-11-15T09:00:00.000Z', '2026-11-22T09:00:00.000Z', { userAgent: 'first' }),
        row(family, '2026-11-15T09:00:00.000Z', '2026-11-22T09:00:00.000Z', { userAgent: 'second' }),
      ],
      newer: [],
      deadlineOf,
      currentFamilyId: family,
      now: NOW,
    });
    expect(tie[0]).toMatchObject({ userAgent: 'second', current: true });
  });

  it('lists nothing without a live token', () => {
    expect(buildSessionItems({ live: [], newer: [], deadlineOf, currentFamilyId: null, now: NOW })).toEqual([]);
  });
});
