// TEST-247 (unit) — the pure progress rules of MOD-20 «My School»
// (learning.progress.ts, D-R134/D-R135): played intervals, the clock cap of a
// playback save, the completion at the academy threshold and the course and
// level progress computed on read.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPLETION_PERCENT,
  MAX_PLAYBACK_RATE,
  PLAYBACK_ALLOWANCE_SECONDS,
  STORED_RANGES_MAX,
  learningActionOf,
  normalizeRanges,
  planPlayback,
  progressOf,
  rangesLength,
  readStoredRanges,
  takeBudget,
  uncoveredParts,
} from './learning.progress.js';
import type { ItemState, PlayedRange, StoredPlayback } from './learning.progress.js';

const T0 = new Date('2026-11-19T10:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

/** A lesson opened two hours before T0 unless a test says otherwise. */
function stored(overrides: Partial<StoredPlayback> = {}): StoredPlayback {
  return { ranges: [], lastPlaybackAt: null, lastOpenedAt: at(-7200), completed: false, ...overrides };
}

describe('normalizeRanges', () => {
  it('sorts, merges overlapping and touching intervals and drops empty ones', () => {
    expect(
      normalizeRanges(
        [
          [30, 40],
          [0, 10],
          [10, 20],
          [35, 50],
          [60, 60],
        ],
        100,
      ),
    ).toEqual([
      [0, 20],
      [30, 50],
    ]);
  });

  it('clamps to [0, duration], rounds outward to whole seconds and accepts a reversed pair', () => {
    expect(
      normalizeRanges(
        [
          [-5, 3.2],
          [95.5, 120],
          [50.7, 40.2],
        ],
        100,
      ),
    ).toEqual([
      [0, 4],
      [40, 51],
      [95, 100],
    ]);
  });

  it('ignores non-finite values and intervals entirely outside the medium', () => {
    expect(
      normalizeRanges(
        [
          [Number.NaN, 10],
          [5, Number.POSITIVE_INFINITY],
          [150, 200],
        ],
        100,
      ),
    ).toEqual([]);
  });
});

describe('uncoveredParts and takeBudget', () => {
  it('keeps only the parts not already covered, in order', () => {
    const covered: PlayedRange[] = [
      [10, 20],
      [40, 50],
    ];
    expect(uncoveredParts([[0, 60]], covered)).toEqual([
      [0, 10],
      [20, 40],
      [50, 60],
    ]);
    expect(uncoveredParts([[12, 18]], covered)).toEqual([]);
    expect(uncoveredParts([[15, 45]], covered)).toEqual([[20, 40]]);
    expect(
      uncoveredParts(
        [
          [0, 5],
          [55, 70],
        ],
        covered,
      ),
    ).toEqual([
      [0, 5],
      [55, 70],
    ]);
    expect(uncoveredParts([[0, 30]], [])).toEqual([[0, 30]]);
  });

  it('keeps the earliest new seconds up to the budget, trimming the interval that crosses it', () => {
    const parts: PlayedRange[] = [
      [0, 10],
      [20, 40],
      [50, 60],
    ];
    expect(takeBudget(parts, 15)).toEqual([
      [0, 10],
      [20, 25],
    ]);
    expect(takeBudget(parts, 100)).toEqual(parts);
    expect(takeBudget(parts, 0)).toEqual([]);
    expect(takeBudget(parts, -3)).toEqual([]);
    expect(takeBudget(parts, 10.9)).toEqual([[0, 10]]);
  });

  it('measures a list of intervals', () => {
    expect(
      rangesLength([
        [0, 10],
        [20, 25],
      ]),
    ).toBe(15);
  });
});

describe('readStoredRanges', () => {
  it('reads the stored jsonb leniently', () => {
    expect(readStoredRanges([[0, 10], [5, 20], 'x', [1], [1, 'a'], null], 100)).toEqual([[0, 20]]);
    expect(readStoredRanges({ not: 'an array' }, 100)).toEqual([]);
    expect(readStoredRanges(null, 100)).toEqual([]);
    expect(readStoredRanges([[90, 200]], 95)).toEqual([[90, 95]]); // the author shortened the medium
  });
});

describe('planPlayback', () => {
  const budgetAfter = (seconds: number) => Math.floor(seconds * MAX_PLAYBACK_RATE) + PLAYBACK_ALLOWANCE_SECONDS;

  it('credits an honest save in full: what played since the opening, within twice the clock', () => {
    const plan = planPlayback(stored({ lastOpenedAt: T0 }), { positionSeconds: 15, ranges: [[0, 15]] }, 100, 90, at(15));
    expect(plan).toMatchObject({ ranges: [[0, 15]], watchedSeconds: 15, positionSeconds: 15, creditedSeconds: 15, capped: false, completes: false, watchedPercent: 15 });
  });

  it('caps a claim beyond the clock — the earliest new seconds are kept and `capped` is true', () => {
    const plan = planPlayback(stored({ lastOpenedAt: T0 }), { positionSeconds: 100, ranges: [[0, 100]] }, 100, 90, at(1));
    expect(plan.creditedSeconds).toBe(budgetAfter(1));
    expect(plan.ranges).toEqual([[0, budgetAfter(1)]]);
    expect(plan.capped).toBe(true);
    expect(plan.completes).toBe(false);
    expect(plan.positionSeconds).toBe(100);
  });

  it('starts the clock at the later of the previous save and the last opening', () => {
    // Saved yesterday, opened again a second ago: one second of clock, not a day.
    const reopened = stored({ lastPlaybackAt: at(-86_400), lastOpenedAt: at(-1) });
    const plan = planPlayback(reopened, { positionSeconds: 100, ranges: [[0, 100]] }, 100, 90, T0);
    expect(plan.creditedSeconds).toBe(budgetAfter(1));
    expect(plan.capped).toBe(true);
    // Saved 15 s ago, opened earlier: the previous save is the start.
    const playing = stored({ ranges: [[0, 15]], lastPlaybackAt: at(-15), lastOpenedAt: at(-60) });
    const next = planPlayback(playing, { positionSeconds: 30, ranges: [[15, 30]] }, 100, 90, T0);
    expect(next).toMatchObject({ creditedSeconds: 15, capped: false, watchedSeconds: 30 });
  });

  it('credits nothing new for seeking to the end: only the seconds actually played count', () => {
    const plan = planPlayback(stored({ ranges: [[0, 20]], lastPlaybackAt: at(-600) }), { positionSeconds: 99, ranges: [[98, 100]] }, 100, 90, T0);
    expect(plan).toMatchObject({ watchedSeconds: 22, positionSeconds: 99, creditedSeconds: 2, completes: false });
    // An empty report adds nothing and moves the position only.
    const idle = planPlayback(stored({ ranges: [[0, 20]], lastPlaybackAt: at(-600) }), { positionSeconds: 99, ranges: [] }, 100, 90, T0);
    expect(idle).toMatchObject({ watchedSeconds: 20, creditedSeconds: 0, capped: false, completes: false, positionSeconds: 99 });
  });

  it('re-playing covered seconds adds nothing and is not "capped"', () => {
    const plan = planPlayback(stored({ ranges: [[0, 50]], lastPlaybackAt: at(-1) }), { positionSeconds: 50, ranges: [[0, 50]] }, 100, 90, T0);
    expect(plan).toMatchObject({ watchedSeconds: 50, creditedSeconds: 0, capped: false });
  });

  it('completes exactly at the threshold, once, and never "completes" an already completed lesson', () => {
    const below = planPlayback(stored({ ranges: [[0, 80]], lastPlaybackAt: at(-600) }), { positionSeconds: 89, ranges: [[80, 89]] }, 100, 90, T0);
    expect(below).toMatchObject({ watchedSeconds: 89, watchedPercent: 89, completes: false });
    const exactly = planPlayback(stored({ ranges: [[0, 80]], lastPlaybackAt: at(-600) }), { positionSeconds: 90, ranges: [[80, 90]] }, 100, 90, T0);
    expect(exactly).toMatchObject({ watchedSeconds: 90, watchedPercent: 90, completes: true });
    const again = planPlayback(stored({ ranges: [[0, 90]], lastPlaybackAt: at(-600), completed: true }), { positionSeconds: 100, ranges: [[90, 100]] }, 100, 90, T0);
    expect(again).toMatchObject({ watchedSeconds: 100, watchedPercent: 100, completes: false });
  });

  it('floors the percent (89.9 % is not 90 %) and clamps the position to the medium', () => {
    const plan = planPlayback(stored({ lastPlaybackAt: at(-3600) }), { positionSeconds: 5000, ranges: [[0, 899]] }, 1000, 90, T0);
    expect(plan).toMatchObject({ watchedSeconds: 899, watchedPercent: 89, completes: false, positionSeconds: 1000 });
    expect(planPlayback(stored(), { positionSeconds: -4, ranges: [] }, 100, 90, T0).positionSeconds).toBe(0);
    expect(planPlayback(stored(), { positionSeconds: Number.NaN, ranges: [] }, 100, 90, T0).positionSeconds).toBe(0);
  });

  it('only the last seconds of a medium never complete it', () => {
    const plan = planPlayback(stored({ lastPlaybackAt: at(-3600) }), { positionSeconds: 100, ranges: [[85, 100]] }, 100, DEFAULT_COMPLETION_PERCENT, T0);
    expect(plan).toMatchObject({ watchedSeconds: 15, completes: false, capped: false });
  });

  it('keeps at most STORED_RANGES_MAX merged intervals', () => {
    const many: PlayedRange[] = Array.from({ length: STORED_RANGES_MAX + 5 }, (_, index) => [index * 2, index * 2 + 1]);
    const plan = planPlayback(stored({ ranges: many.slice(0, STORED_RANGES_MAX), lastPlaybackAt: at(-3600) }), { positionSeconds: 0, ranges: many.slice(STORED_RANGES_MAX) }, 1000, 90, T0);
    expect(plan.ranges).toHaveLength(STORED_RANGES_MAX);
    expect(plan.watchedSeconds).toBe(STORED_RANGES_MAX);
  });
});

describe('progressOf', () => {
  const done = (completedAt: string): ItemState => ({ state: 'completed', completedAt: new Date(completedAt) });
  const items = [
    { id: 'a', isRequired: true },
    { id: 'b', isRequired: true },
    { id: 'c', isRequired: true },
    { id: 'o', isRequired: false },
  ];

  it('counts completed required lessons over required ones, floored; optional lessons never block', () => {
    const states = new Map<string, ItemState>([
      ['a', done('2026-11-01T10:00:00Z')],
      ['b', done('2026-11-02T10:00:00Z')],
      ['c', { state: 'in_progress', completedAt: null }],
      ['o', done('2026-11-03T10:00:00Z')],
    ]);
    expect(progressOf(items, states)).toEqual({ total: 4, required: 3, completed: 3, completedRequired: 2, percent: 66, isComplete: false, completedAt: null });
  });

  it('is complete once every required lesson is, at the latest required completion — an optional one left open does not matter', () => {
    const states = new Map<string, ItemState>([
      ['a', done('2026-11-01T10:00:00Z')],
      ['b', done('2026-11-05T10:00:00Z')],
      ['c', done('2026-11-02T10:00:00Z')],
    ]);
    const progress = progressOf(items, states);
    expect(progress).toMatchObject({ completed: 3, completedRequired: 3, percent: 100, isComplete: true });
    expect(progress.completedAt?.toISOString()).toBe('2026-11-05T10:00:00.000Z');
  });

  it('has no percent and is never complete without a required lesson', () => {
    const optional = [{ id: 'o', isRequired: false }];
    expect(progressOf(optional, new Map([['o', done('2026-11-01T10:00:00Z')]]))).toEqual({
      total: 1,
      required: 0,
      completed: 1,
      completedRequired: 0,
      percent: null,
      isComplete: false,
      completedAt: null,
    });
    expect(progressOf([], new Map())).toEqual({ total: 0, required: 0, completed: 0, completedRequired: 0, percent: null, isComplete: false, completedAt: null });
  });

  it('treats a lesson without a state as not started', () => {
    expect(progressOf(items, new Map())).toMatchObject({ completed: 0, completedRequired: 0, percent: 0, isComplete: false });
  });
});

describe('learningActionOf', () => {
  it('start before any history, continue while under way, review once complete', () => {
    expect(learningActionOf(false, { isComplete: false })).toBe('start');
    expect(learningActionOf(true, { isComplete: false })).toBe('continue');
    expect(learningActionOf(true, { isComplete: true })).toBe('review');
    expect(learningActionOf(false, { isComplete: true })).toBe('review');
  });
});
