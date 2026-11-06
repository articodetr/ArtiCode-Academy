// TEST-077 (unit) — instants and time ranges of MOD-06 lessons.
import { describe, expect, it } from 'vitest';
import { instantsOverlap, isInstant, timeRangeProblem, toInstant, toIso } from './lessons.time.js';

describe('isInstant / toInstant / toIso', () => {
  it('accepts ISO 8601 with an offset or Z and rejects dates, local times and impossible instants', () => {
    expect(isInstant('2026-11-10T10:00:00+03:00')).toBe(true);
    expect(isInstant('2026-11-10T10:00Z')).toBe(true);
    expect(isInstant('2026-11-10T10:00:00.250Z')).toBe(true);
    expect(isInstant('2026-11-10T10:00:00')).toBe(false); // no offset
    expect(isInstant('2026-11-10')).toBe(false);
    expect(isInstant('2026-13-10T10:00:00Z')).toBe(false);
    expect(isInstant('2026-02-30T10:00:00Z')).toBe(false);
    expect(isInstant(1762768800000)).toBe(false);
    expect(isInstant(null)).toBe(false);
    expect(toIso(toInstant('2026-11-10T10:00:00+03:00'))).toBe('2026-11-10T07:00:00.000Z');
  });
});

describe('timeRangeProblem / instantsOverlap', () => {
  it('refuses an empty or inverted range and one longer than the limit; back-to-back instants do not overlap', () => {
    const at = (value: string) => new Date(value);
    expect(timeRangeProblem(at('2026-11-10T10:00:00Z'), at('2026-11-10T11:30:00Z'))).toBeNull();
    expect(timeRangeProblem(at('2026-11-10T10:00:00Z'), at('2026-11-10T22:00:00Z'))).toBeNull();
    expect(timeRangeProblem(at('2026-11-10T10:00:00Z'), at('2026-11-10T10:00:00Z'))).toBe('empty');
    expect(timeRangeProblem(at('2026-11-10T11:00:00Z'), at('2026-11-10T10:00:00Z'))).toBe('empty');
    expect(timeRangeProblem(at('2026-11-10T10:00:00Z'), at('2026-11-10T22:00:01Z'))).toBe('too_long');
    expect(timeRangeProblem(at('2026-11-10T10:00:00Z'), at('2026-11-10T12:00:00Z'), 1)).toBe('too_long');
    expect(instantsOverlap(at('2026-11-10T10:00:00Z'), at('2026-11-10T11:00:00Z'), at('2026-11-10T11:00:00Z'), at('2026-11-10T12:00:00Z'))).toBe(false);
    expect(instantsOverlap(at('2026-11-10T10:00:00Z'), at('2026-11-10T11:00:00Z'), at('2026-11-10T10:59:00Z'), at('2026-11-10T12:00:00Z'))).toBe(true);
  });
});
