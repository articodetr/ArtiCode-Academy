// TEST-247 (unit) — the curriculum tree of MOD-20 «My School»
// (learning.curriculum.ts, D-R130/D-R133): levels and their lessons for
// learners and authors, the learning order across level boundaries and
// where «continue learning» opens.
import { describe, expect, it } from 'vitest';
import { buildCurriculum, learningOrder, neighborsOf, resumeTargetOf } from './learning.curriculum.js';
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
});
