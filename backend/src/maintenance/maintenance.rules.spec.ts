// TEST-204 (unit part) — MOD-17-T05: the cutoffs and the UUIDv7 bound of the
// daily maintenance command.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { uuidV7Time } from '../auth/refresh-family.js';
import {
  DAY_MS,
  maintenanceCutoffs,
  minUuidV7,
  refreshFamilyCutoff,
  verificationTokenCutoff,
} from './maintenance.rules.js';

/** A UUIDv7 of `ms` with the given 74 random bits written as 19 hex digits (the variant bits are forced). */
function uuidV7(ms: number, tail: string): string {
  const hex = ms.toString(16).padStart(12, '0');
  const rand = tail.padEnd(19, '0').slice(0, 19);
  const variant = ((Number.parseInt(rand[3]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${rand.slice(0, 3)}-${variant}${rand.slice(4, 7)}-${rand.slice(7, 19)}`;
}

/** PostgreSQL's uuid order: the 16 bytes compared one by one. */
function compareAsUuid(a: string, b: string): number {
  const bytes = (id: string) => Buffer.from(id.replaceAll('-', ''), 'hex');
  return Buffer.compare(bytes(a), bytes(b));
}

const NOW = new Date('2026-11-13T09:30:15.123Z');

describe('maintenance cutoffs (TEST-204)', () => {
  it('keeps verification tokens 30 days and refresh families AUTH_REFRESH_FAMILY_MAX_DAYS + 7 days', () => {
    expect(verificationTokenCutoff(NOW).getTime()).toBe(
      NOW.getTime() - 30 * DAY_MS,
    );
    expect(refreshFamilyCutoff(NOW, 30).getTime()).toBe(
      NOW.getTime() - 37 * DAY_MS,
    );
    expect(refreshFamilyCutoff(NOW, 1).getTime()).toBe(
      NOW.getTime() - 8 * DAY_MS,
    );
    expect(refreshFamilyCutoff(NOW, 365).getTime()).toBe(
      NOW.getTime() - 372 * DAY_MS,
    );

    const cutoffs = maintenanceCutoffs(NOW, 30);
    expect(cutoffs.verificationCutoff).toEqual(verificationTokenCutoff(NOW));
    expect(cutoffs.refreshFamilyCutoff).toEqual(refreshFamilyCutoff(NOW, 30));
    expect(cutoffs.refreshFamilyBound).toBe(
      minUuidV7(cutoffs.refreshFamilyCutoff),
    );
  });

  it('refuses an invalid date or family lifetime', () => {
    expect(() => verificationTokenCutoff(new Date(Number.NaN))).toThrow(
      RangeError,
    );
    for (const days of [0, -1, 1.5, Number.NaN]) {
      expect(() => refreshFamilyCutoff(NOW, days)).toThrow(RangeError);
    }
    expect(() => minUuidV7(new Date(-1))).toThrow(RangeError);
    expect(() => minUuidV7(new Date(2 ** 48))).toThrow(RangeError);
  });
});

describe('minUuidV7 (TEST-204)', () => {
  it('is a version 7 UUID that carries exactly its millisecond', () => {
    const bound = minUuidV7(NOW);
    expect(bound).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7000-8000-000000000000$/);
    expect(uuidV7Time(bound)).toEqual(NOW);
    expect(minUuidV7(new Date(0))).toBe('00000000-0000-7000-8000-000000000000');
    expect(minUuidV7(new Date(2 ** 48 - 1))).toBe(
      'ffffffff-ffff-7000-8000-000000000000',
    );
  });

  it('is the smallest UUIDv7 of its millisecond, above every UUIDv7 of an earlier one', () => {
    const ms = NOW.getTime();
    const bound = minUuidV7(NOW);
    const sameMsSmallest = uuidV7(ms, '0000000000000000000');
    const sameMsLargest = uuidV7(ms, 'fffffffffffffffffff');
    const earlierLargest = uuidV7(ms - 1, 'fffffffffffffffffff');
    const laterSmallest = uuidV7(ms + 1, '0000000000000000000');

    expect(sameMsSmallest).toBe(bound);
    expect(uuidV7Time(sameMsLargest)).toEqual(NOW);
    expect(uuidV7Time(earlierLargest)?.getTime()).toBe(ms - 1);

    // The same order in bytes (PostgreSQL) and in lower-case text.
    for (const compare of [
      compareAsUuid,
      (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
    ]) {
      expect(compare(earlierLargest, bound)).toBeLessThan(0);
      expect(compare(sameMsSmallest, bound)).toBe(0);
      expect(compare(sameMsLargest, bound)).toBeGreaterThan(0);
      expect(compare(laterSmallest, bound)).toBeGreaterThan(0);
    }
  });

  it('splits random UUIDv7s exactly by their timestamp', () => {
    const bound = minUuidV7(NOW);
    for (let i = 0; i < 200; i += 1) {
      const ms = NOW.getTime() + (i % 5) - 2; // two milliseconds on each side
      const id = uuidV7(ms, randomBytes(10).toString('hex'));
      expect(uuidV7Time(id)?.getTime()).toBe(ms);
      expect(compareAsUuid(id, bound) < 0).toBe(ms < NOW.getTime());
    }
  });
});
