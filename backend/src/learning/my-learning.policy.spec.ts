// TEST-247 (unit) — the learner-side rules of MOD-20 «My School»
// (my-learning.policy.ts, D-R132/D-R134): course access from the caller's own
// enrollments, the academy threshold read defensively, the watched percent,
// the latest activity and the order of «My School».
import { describe, expect, it } from 'vitest';
import type { EnrollmentStatus } from '../generated/prisma/client.js';
import { compareMyLearning, completionPercentOf, isPlaybackRanges, lastActivityOf, learningAccessOf, watchedPercentOf } from './my-learning.policy.js';
import type { MyLearningSortKey } from './my-learning.policy.js';

const row = (id: string, status: EnrollmentStatus, enrolledAt: string) => ({ id, status, enrolledAt: new Date(enrolledAt) });

describe('learningAccessOf', () => {
  it('prefers an active enrollment, then the newest; lists every owned one', () => {
    const access = learningAccessOf([row('old', 'completed', '2026-01-01'), row('act', 'active', '2025-01-01'), row('new', 'completed', '2026-06-01'), row('gone', 'withdrawn', '2026-07-01')]);
    expect(access.allowed).toBe(true);
    if (!access.allowed) return;
    expect(access.enrollment.id).toBe('act');
    expect(access.owned.map((entry) => entry.id)).toEqual(['act', 'new', 'old']);
    const completedOnly = learningAccessOf([row('a', 'completed', '2026-01-01'), row('b', 'completed', '2026-03-01')]);
    expect(completedOnly.allowed && completedOnly.enrollment.id).toBe('b');
  });

  it('refuses with `pending` while the only own enrollment awaits approval, else `not_enrolled`', () => {
    expect(learningAccessOf([row('p', 'pending', '2026-01-01'), row('w', 'withdrawn', '2025-01-01')])).toEqual({ allowed: false, reason: 'pending' });
    expect(learningAccessOf([row('w', 'withdrawn', '2025-01-01'), row('c', 'cancelled', '2025-02-01')])).toEqual({ allowed: false, reason: 'not_enrolled' });
    expect(learningAccessOf([])).toEqual({ allowed: false, reason: 'not_enrolled' });
  });
});

describe('completionPercentOf', () => {
  it('reads settings.learning.videoCompletionPercent when it is an integer 50..100, else the default 90', () => {
    expect(completionPercentOf({ learning: { videoCompletionPercent: 75 } })).toBe(75);
    expect(completionPercentOf({ learning: { videoCompletionPercent: 50 } })).toBe(50);
    expect(completionPercentOf({ learning: { videoCompletionPercent: 100 } })).toBe(100);
    for (const bad of [49, 101, 80.5, '80', null]) expect(completionPercentOf({ learning: { videoCompletionPercent: bad } })).toBe(90);
    for (const settings of [{}, null, undefined, [], 'x', { learning: null }, { learning: [] }]) expect(completionPercentOf(settings)).toBe(90);
  });
});

describe('watchedPercentOf', () => {
  it('floors watched ÷ duration, caps at 100 and is null without a measured length', () => {
    expect(watchedPercentOf(89, 100)).toBe(89);
    expect(watchedPercentOf(2, 3)).toBe(66);
    expect(watchedPercentOf(120, 100)).toBe(100);
    expect(watchedPercentOf(0, 100)).toBe(0);
    expect(watchedPercentOf(10, null)).toBeNull();
    expect(watchedPercentOf(10, 0)).toBeNull();
  });
});

describe('lastActivityOf', () => {
  it('is the latest opening or completion', () => {
    const d = (value: string) => new Date(value);
    expect(
      lastActivityOf([
        { lastOpenedAt: d('2026-11-01T10:00:00Z'), completedAt: null },
        { lastOpenedAt: null, completedAt: d('2026-11-03T10:00:00Z') },
        { lastOpenedAt: d('2026-11-02T10:00:00Z'), completedAt: d('2026-11-02T11:00:00Z') },
      ])?.toISOString(),
    ).toBe('2026-11-03T10:00:00.000Z');
    expect(lastActivityOf([{ lastOpenedAt: null, completedAt: null }])).toBeNull();
    expect(lastActivityOf([])).toBeNull();
  });
});

describe('compareMyLearning', () => {
  const key = (enrollmentId: string, relation: 'self' | 'child', lastActivityAt: string | null, enrolledAt: string): MyLearningSortKey => ({
    enrollmentId,
    relation,
    lastActivityAt: lastActivityAt ? new Date(lastActivityAt) : null,
    enrolledAt: new Date(enrolledAt),
  });

  it('self before child, then the latest activity (none last), then the newest enrollment', () => {
    const keys = [
      key('child-recent', 'child', '2026-11-10', '2026-01-01'),
      key('self-none-new', 'self', null, '2026-06-01'),
      key('self-old-activity', 'self', '2026-10-01', '2026-01-01'),
      key('self-none-old', 'self', null, '2026-02-01'),
      key('self-recent', 'self', '2026-11-01', '2025-01-01'),
    ];
    expect([...keys].sort(compareMyLearning).map((entry) => entry.enrollmentId)).toEqual(['self-recent', 'self-old-activity', 'self-none-new', 'self-none-old', 'child-recent']);
  });
});

describe('isPlaybackRanges', () => {
  it('accepts up to 50 pairs of finite numbers 0..86400 and refuses anything else', () => {
    expect(isPlaybackRanges([])).toBe(true);
    expect(isPlaybackRanges([[0, 10.5], [20, 86_400]])).toBe(true);
    expect(isPlaybackRanges(Array.from({ length: 50 }, () => [0, 1]))).toBe(true);
    expect(isPlaybackRanges(Array.from({ length: 51 }, () => [0, 1]))).toBe(false);
    for (const bad of [null, 'x', {}, [[0]], [[0, 1, 2]], [[0, '5']], [[-1, 5]], [[0, 86_401]], [[0, Number.NaN]], [[0, Number.POSITIVE_INFINITY]], [5]]) {
      expect(isPlaybackRanges(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
