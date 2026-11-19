// TEST-247 (unit) — the curriculum tree of MOD-20 «My School»
// (learning.curriculum.ts, D-R130/D-R133): levels and their lessons for
// learners and authors, the learning order across level boundaries and
// where «continue learning» opens.
import { describe, expect, it } from 'vitest';
import { buildCurriculum, isLevelOpen, learningOrder, levelOpensOn, levelStateOf, neighborsOf, resumeTargetOf } from './learning.curriculum.js';
import type { CurriculumItemRow, CurriculumSectionRow } from './learning.curriculum.js';

const section = (id: string, sortOrder: number): CurriculumSectionRow => ({ id, sortOrder });
const item = (id: string, sectionId: string | null, sortOrder: number, isPublished = true): CurriculumItemRow => ({ id, sectionId, sortOrder, isPublished });

const ids = (groups: ReturnType<typeof buildCurriculum>) => groups.map((group) => [group.section?.id ?? null, group.number, group.items.map((entry) => entry.id)]);

describe('buildCurriculum', () => {
  // Levels given out of order; a draft lesson in L2; an empty level L3; one lesson outside every level.
  const sections = [section('L2', 1), section('L1', 0), section('L3', 2)];
  const items = [item('b2', 'L2', 3), item('a1', 'L1', 0), item('loose', null, 5), item('a2', 'L1', 1), item('b1', 'L2', 2), item('draft', 'L2', 4, false)];

  it('learners see the levels in order with their published lessons, without an empty level, and the lessons outside every level last', () => {
    expect(ids(buildCurriculum(sections, items, { learner: true }))).toEqual([
      ['L1', 1, ['a1', 'a2']],
      ['L2', 2, ['b1', 'b2']],
      [null, 3, ['loose']],
    ]);
  });

  it('authors see every level, the empty one and the unpublished lessons too', () => {
    expect(ids(buildCurriculum(sections, items, { learner: false }))).toEqual([
      ['L1', 1, ['a1', 'a2']],
      ['L2', 2, ['b1', 'b2', 'draft']],
      ['L3', 3, []],
      [null, 4, ['loose']],
    ]);
  });

  it('a level left only with unpublished lessons is dropped for learners and the numbers follow what is shown', () => {
    const groups = buildCurriculum([section('L1', 0), section('L2', 1), section('L3', 2)], [item('x', 'L1', 0, false), item('y', 'L2', 1), item('z', 'L3', 2)], { learner: true });
    expect(ids(groups)).toEqual([
      ['L2', 1, ['y']],
      ['L3', 2, ['z']],
    ]);
  });

  it('a course without levels is one implicit group; a lesson pointing at an unknown level joins it', () => {
    expect(ids(buildCurriculum([], [item('b', null, 1), item('a', null, 0)], { learner: true }))).toEqual([[null, 1, ['a', 'b']]]);
    expect(ids(buildCurriculum([section('L1', 0)], [item('a', 'L1', 0), item('ghost', 'gone', 1)], { learner: true }))).toEqual([
      ['L1', 1, ['a']],
      [null, 2, ['ghost']],
    ]);
  });

  it('no lesson at all: nothing for learners, the empty levels for authors', () => {
    expect(buildCurriculum([section('L1', 0)], [], { learner: true })).toEqual([]);
    expect(ids(buildCurriculum([section('L1', 0)], [], { learner: false }))).toEqual([['L1', 1, []]]);
  });
});

describe('learningOrder and neighborsOf', () => {
  const groups = buildCurriculum(
    [section('L1', 0), section('L2', 1)],
    [item('a1', 'L1', 0), item('a2', 'L1', 1), item('b1', 'L2', 2), item('b2', 'L2', 3), item('loose', null, 4)],
    { learner: true },
  );
  const order = learningOrder(groups);

  it('flattens the groups in display order', () => {
    expect(order).toEqual(['a1', 'a2', 'b1', 'b2', 'loose']);
  });

  it('crosses level boundaries in both directions', () => {
    expect(neighborsOf(order, 'a2')).toEqual({ previous: 'a1', next: 'b1' });
    expect(neighborsOf(order, 'b1')).toEqual({ previous: 'a2', next: 'b2' });
    expect(neighborsOf(order, 'b2')).toEqual({ previous: 'b1', next: 'loose' });
  });

  it('has no previous at the start, no next at the end, and nothing for an unknown lesson', () => {
    expect(neighborsOf(order, 'a1')).toEqual({ previous: null, next: 'a2' });
    expect(neighborsOf(order, 'loose')).toEqual({ previous: 'b2', next: null });
    expect(neighborsOf(order, 'nope')).toEqual({ previous: null, next: null });
    expect(neighborsOf(['only'], 'only')).toEqual({ previous: null, next: null });
  });
});

describe('resumeTargetOf', () => {
  // Learning order a(0) b(1) d(3) e(4); c(2) was unpublished.
  const order = ['a', 'b', 'd', 'e'];
  const sortKeys: Record<string, number> = { a: 0, b: 1, c: 2, d: 3, e: 4 };
  const sortKeyOf = (id: string) => sortKeys[id] ?? -1;

  it('opens the first lesson when nothing was opened yet', () => {
    expect(resumeTargetOf(order, null, new Set(), sortKeyOf)).toEqual({ itemId: 'a', reason: 'first' });
  });

  it('opens the lesson opened last while it is still shown — even when it is completed', () => {
    expect(resumeTargetOf(order, { itemId: 'd', sortKey: 3 }, new Set(['d']), sortKeyOf)).toEqual({ itemId: 'd', reason: 'last' });
  });

  it('replaces an unpublished last lesson by the first one after it that is not completed', () => {
    expect(resumeTargetOf(order, { itemId: 'c', sortKey: 2 }, new Set(), sortKeyOf)).toEqual({ itemId: 'd', reason: 'replaced' });
    expect(resumeTargetOf(order, { itemId: 'c', sortKey: 2 }, new Set(['d']), sortKeyOf)).toEqual({ itemId: 'e', reason: 'replaced' });
  });

  it('falls back to the first lesson not completed, then to the first lesson', () => {
    expect(resumeTargetOf(order, { itemId: 'c', sortKey: 2 }, new Set(['d', 'e']), sortKeyOf)).toEqual({ itemId: 'a', reason: 'replaced' });
    expect(resumeTargetOf(order, { itemId: 'c', sortKey: 2 }, new Set(['a', 'd', 'e']), sortKeyOf)).toEqual({ itemId: 'b', reason: 'replaced' });
    expect(resumeTargetOf(order, { itemId: 'c', sortKey: 2 }, new Set(order), sortKeyOf)).toEqual({ itemId: 'a', reason: 'replaced' });
  });

  it('is null when the course shows no lesson', () => {
    expect(resumeTargetOf([], { itemId: 'c', sortKey: 2 }, new Set(), sortKeyOf)).toBeNull();
    expect(resumeTargetOf([], null, new Set(), sortKeyOf)).toBeNull();
  });

  // TEST-262 (unit) — D-R145: the resume point never lands on a lesson of a closed level.
  it('without an available set every lesson counts, as before', () => {
    expect(resumeTargetOf(order, { itemId: 'b', sortKey: 1 }, new Set(), sortKeyOf, undefined)).toEqual({ itemId: 'b', reason: 'last' });
    expect(resumeTargetOf(order, { itemId: 'b', sortKey: 1 }, new Set(), sortKeyOf, new Set(order))).toEqual({ itemId: 'b', reason: 'last' });
  });

  it('starts at the first available lesson when the first level is closed', () => {
    expect(resumeTargetOf(order, null, new Set(), sortKeyOf, new Set(['d', 'e']))).toEqual({ itemId: 'd', reason: 'first' });
  });

  it('replaces a last lesson whose level is closed by the next available one not completed, else the first available', () => {
    // a and b open; d and e in a closed level. The learner had opened d before it closed.
    const open = new Set(['a', 'b']);
    expect(resumeTargetOf(order, { itemId: 'd', sortKey: 3 }, new Set(), sortKeyOf, open)).toEqual({ itemId: 'a', reason: 'replaced' });
    expect(resumeTargetOf(order, { itemId: 'd', sortKey: 3 }, new Set(['a']), sortKeyOf, open)).toEqual({ itemId: 'b', reason: 'replaced' });
    expect(resumeTargetOf(order, { itemId: 'd', sortKey: 3 }, new Set(['a', 'b']), sortKeyOf, open)).toEqual({ itemId: 'a', reason: 'replaced' });
    // An unpublished last lesson (c) skips the closed d and e as well.
    expect(resumeTargetOf(order, { itemId: 'c', sortKey: 2 }, new Set(), sortKeyOf, new Set(['a', 'b', 'e']))).toEqual({ itemId: 'e', reason: 'replaced' });
    expect(resumeTargetOf(order, { itemId: 'c', sortKey: 2 }, new Set(['e']), sortKeyOf, new Set(['a', 'b', 'e']))).toEqual({ itemId: 'a', reason: 'replaced' });
  });

  it('is null when no lesson is available', () => {
    expect(resumeTargetOf(order, null, new Set(), sortKeyOf, new Set())).toBeNull();
    expect(resumeTargetOf(order, { itemId: 'a', sortKey: 0 }, new Set(), sortKeyOf, new Set(['zz']))).toBeNull();
  });
});

// TEST-262 (unit) — D-R145: a level that opens N days after the learner's class starts, in the academy's zone.
describe('levelOpensOn, isLevelOpen and levelStateOf', () => {
  it('adds the delay to the class start date, across months, years and leap days', () => {
    expect(levelOpensOn('2026-11-09', 0)).toBe('2026-11-09');
    expect(levelOpensOn('2026-11-09', 5)).toBe('2026-11-14');
    expect(levelOpensOn('2026-11-09', 30)).toBe('2026-12-09');
    expect(levelOpensOn('2026-12-20', 15)).toBe('2027-01-04');
    expect(levelOpensOn('2028-02-27', 2)).toBe('2028-02-29');
    expect(levelOpensOn('2026-03-28', 2)).toBe('2026-03-30'); // a DST weekend changes nothing: dates are UTC midnights
    expect(levelOpensOn('2026-01-01', 365)).toBe('2027-01-01');
  });

  it('has no date without a class start or without a delay', () => {
    expect(levelOpensOn(null, 5)).toBeNull();
    expect(levelOpensOn('2026-11-09', null)).toBeNull();
    expect(levelOpensOn(null, null)).toBeNull();
  });

  it('opens on the day itself, never before', () => {
    expect(isLevelOpen(null, '2026-11-19')).toBe(true);
    expect(isLevelOpen('2026-11-19', '2026-11-19')).toBe(true);
    expect(isLevelOpen('2026-11-18', '2026-11-19')).toBe(true);
    expect(isLevelOpen('2026-11-20', '2026-11-19')).toBe(false);
    expect(isLevelOpen('2027-01-01', '2026-12-31')).toBe(false);
  });

  it('the state of a group: the implicit group and a level without a delay are always open; a dated level keeps its day once open', () => {
    const today = '2026-11-19';
    const startsOn = '2026-11-09'; // ten days ago
    expect(levelStateOf(null, startsOn, today)).toEqual({ isOpen: true, opensOn: null });
    expect(levelStateOf({ releaseAfterDays: null }, startsOn, today)).toEqual({ isOpen: true, opensOn: null });
    expect(levelStateOf({ releaseAfterDays: 5 }, startsOn, today)).toEqual({ isOpen: true, opensOn: '2026-11-14' });
    expect(levelStateOf({ releaseAfterDays: 10 }, startsOn, today)).toEqual({ isOpen: true, opensOn: '2026-11-19' });
    expect(levelStateOf({ releaseAfterDays: 30 }, startsOn, today)).toEqual({ isOpen: false, opensOn: '2026-12-09' });
    expect(levelStateOf({ releaseAfterDays: 30 }, null, today)).toEqual({ isOpen: true, opensOn: null }); // a class without a start date opens everything
    // Before the class starts, even a level with no delay (0) waits for the start day.
    expect(levelStateOf({ releaseAfterDays: 0 }, '2026-11-25', today)).toEqual({ isOpen: false, opensOn: '2026-11-25' });
  });
});
