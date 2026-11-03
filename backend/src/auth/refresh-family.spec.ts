// TEST-065 (MOD-01-H03): the family start is read from its UUIDv7 id.
import { describe, expect, it } from 'vitest';
import { familyDeadline, uuidV7Time } from './refresh-family.js';

/** The UUIDv7 example of RFC 9562 (appendix A.6): 2022-02-22T19:22:22.000Z. */
const RFC_EXAMPLE = '017f22e2-79b0-7cc3-98c4-dc0c0c07398f';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('refresh-token family deadline (TEST-065)', () => {
  it('reads the Unix-millisecond timestamp of a version 7 UUID, in either case', () => {
    expect(uuidV7Time(RFC_EXAMPLE)?.toISOString()).toBe('2022-02-22T19:22:22.000Z');
    expect(uuidV7Time(RFC_EXAMPLE.toUpperCase())?.toISOString()).toBe('2022-02-22T19:22:22.000Z');
  });

  it('returns null for anything that is not a UUIDv7 (other versions, wrong variant, malformed)', () => {
    expect(uuidV7Time('9b2f6a1e-4c3d-4f5a-8b6c-7d8e9f0a1b2c')).toBeNull(); // v4
    expect(uuidV7Time('017f22e2-79b0-7cc3-c8c4-dc0c0c07398f')).toBeNull(); // variant 110x
    expect(uuidV7Time('017f22e2-79b0-7cc3-98c4-dc0c0c07398')).toBeNull(); // one digit short
    expect(uuidV7Time('017f22e279b07cc398c4dc0c0c07398f')).toBeNull(); // no dashes
    expect(uuidV7Time('')).toBeNull();
  });

  it('puts the deadline at the family start plus the maximum lifetime, and has none for a non-v7 id', () => {
    expect(familyDeadline(RFC_EXAMPLE, 30 * DAY_MS)?.toISOString()).toBe('2022-03-24T19:22:22.000Z');
    expect(familyDeadline('9b2f6a1e-4c3d-4f5a-8b6c-7d8e9f0a1b2c', 30 * DAY_MS)).toBeNull();
  });
});
