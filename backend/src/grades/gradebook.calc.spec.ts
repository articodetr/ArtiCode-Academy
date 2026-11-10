// TEST-131 (unit) — the final-grade formula of MOD-09 (D17 = D-R43; D-R45): weights, late penalty, absent/excused/missing, rounding, readiness.
import { describe, expect, it } from 'vitest';
import { canonicalJson, cellOutcome, isReady, isWeighted, readinessOf, weightedPercent } from './gradebook.calc.js';
import type { CellInput, GradeComponent } from './gradebook.calc.js';

const assignment = (id: string, weight: string | null, maxScore: string, latePenaltyPercent: string | null = null, status: GradeComponent['status'] = 'closed'): GradeComponent => ({
  kind: 'assignment',
  id,
  weight,
  maxScore,
  latePenaltyPercent,
  status,
});
const exam = (id: string, weight: string | null, maxScore: string, status: GradeComponent['status'] = 'published'): GradeComponent => ({ kind: 'exam', id, weight, maxScore, latePenaltyPercent: null, status });
const graded = (score: string, late = false): CellInput => ({ kind: 'assignment', lastGradedScore: score, lastGradedLate: late, latestStatus: 'graded' });
const scored = (score: string): CellInput => ({ kind: 'exam', status: 'scored', score });
const percent = (components: GradeComponent[], cells: CellInput[], mode: 'current' | 'final' = 'final') =>
  weightedPercent(
    components,
    components.map((component, index) => cellOutcome(component, cells[index]!)),
    mode,
  );

describe('cellOutcome', () => {
  it('applies the late penalty to the latest graded attempt only when it is late', () => {
    expect(cellOutcome(assignment('a', '30', '20', '10'), graded('18', true))).toMatchObject({ status: 'graded', score: '18', effectiveScore: '16.20', late: true, counts: 'value' });
    expect(cellOutcome(assignment('a', '30', '20', '10'), graded('18'))).toMatchObject({ effectiveScore: '18.00', late: false });
    expect(cellOutcome(assignment('a', '30', '20'), graded('18', true))).toMatchObject({ effectiveScore: '18.00', late: true }); // no penalty set
  });

  it('reads the review state of the latest attempt: awaiting review keeps the earlier graded score, a return without a graded attempt is missing', () => {
    expect(cellOutcome(assignment('a', '1', '20'), { kind: 'assignment', lastGradedScore: '12', lastGradedLate: false, latestStatus: 'submitted' })).toMatchObject({ status: 'awaiting_review', counts: 'value', effectiveScore: '12.00' });
    expect(cellOutcome(assignment('a', '1', '20'), { kind: 'assignment', lastGradedScore: null, lastGradedLate: false, latestStatus: 'returned' })).toMatchObject({ status: 'returned', counts: 'missing' });
    expect(cellOutcome(assignment('a', '1', '20'), { kind: 'assignment', lastGradedScore: null, lastGradedLate: false, latestStatus: null })).toMatchObject({ status: 'missing', counts: 'missing' });
  });

  it('counts an absence as 0, leaves an excused result out and a missing one missing', () => {
    expect(cellOutcome(exam('e', '1', '50'), { kind: 'exam', status: 'absent', score: null })).toMatchObject({ status: 'absent', effectiveScore: '0.00', counts: 'value' });
    expect(cellOutcome(exam('e', '1', '50'), { kind: 'exam', status: 'excused', score: null })).toMatchObject({ status: 'excused', counts: 'excluded' });
    expect(cellOutcome(exam('e', '1', '50'), { kind: 'exam', status: null, score: null })).toMatchObject({ status: 'missing', counts: 'missing' });
  });
});

describe('weightedPercent (D17 = D-R43)', () => {
  const components = [assignment('a', '30', '20', '10'), exam('e', '70', '50')];

  it('is the weighted average of score ÷ max over the weighted components', () => {
    // 100 × (30 × 16.2/20 + 70 × 40/50) ÷ 100 = 24.3 + 56 = 80.3
    expect(percent(components, [graded('18', true), scored('40')])).toBe('80.30');
  });

  it('leaves an excused component out of both sums and counts an absence as 0', () => {
    expect(percent(components, [graded('18', true), { kind: 'exam', status: 'excused', score: null }])).toBe('81.00');
    expect(percent(components, [graded('18', true), { kind: 'exam', status: 'absent', score: null }])).toBe('24.30');
  });

  it('drops a missing component from the current average and counts it as 0 in the final one (D-R45)', () => {
    const cells: CellInput[] = [graded('18', true), { kind: 'exam', status: null, score: null }];
    expect(percent(components, cells, 'current')).toBe('81.00');
    expect(percent(components, cells, 'final')).toBe('24.30');
  });

  it('ignores components without a weight or with weight 0; nothing weighted is null', () => {
    const informational = [assignment('a', null, '20'), exam('e', '0', '50'), exam('f', '10', '10')];
    expect(isWeighted(informational[0]!)).toBe(false);
    expect(isWeighted(informational[1]!)).toBe(false);
    expect(percent(informational, [graded('2'), scored('0'), scored('7')])).toBe('70.00');
    expect(percent([assignment('a', null, '20')], [graded('20')])).toBeNull();
    expect(percent(components, [{ kind: 'assignment', lastGradedScore: null, lastGradedLate: false, latestStatus: null }, { kind: 'exam', status: 'excused', score: null }], 'current')).toBeNull();
  });

  it('gives the sum of points when every weight equals the maximum score', () => {
    const points = [assignment('a', '20', '20'), exam('e', '80', '80')];
    expect(percent(points, [graded('10'), scored('40')])).toBe('50.00'); // (10 + 40) ÷ (20 + 80)
  });

  it('rounds half up to two places with exact decimals', () => {
    expect(percent([exam('e', '1', '200')], [scored('1.01')])).toBe('0.51'); // 0.505
    expect(percent([exam('a', '1', '3'), exam('b', '1', '3'), exam('c', '1', '3')], [scored('1'), scored('1'), scored('1')])).toBe('33.33');
    expect(percent([exam('a', '1', '3'), exam('b', '2', '3')], [scored('2'), scored('2')])).toBe('66.67');
  });
});

describe('readinessOf (D-R45)', () => {
  it('counts the open weighted assignments, the weighted unpublished exams and the latest attempts waiting for review', () => {
    const components = [assignment('a', '30', '20', null, 'open'), assignment('b', null, '20', null, 'open'), exam('e', '70', '50', 'scheduled'), exam('f', null, '10', 'draft')];
    const s1 = components.map((component, index) =>
      cellOutcome(component, index < 2 ? { kind: 'assignment', lastGradedScore: null, lastGradedLate: false, latestStatus: 'submitted' } : { kind: 'exam', status: null, score: null }),
    );
    const s2 = components.map((component, index) => cellOutcome(component, index < 2 ? graded('10') : scored('10')));
    const readiness = readinessOf(components, [s1, s2]);
    expect(readiness).toEqual({ openAssignments: 1, awaitingReview: 1, unpublishedExams: 1, weightedComponents: 2 });
    expect(isReady(readiness)).toBe(false);
    expect(isReady({ openAssignments: 0, awaitingReview: 0, unpublishedExams: 0, weightedComponents: 0 })).toBe(true);
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined values', () => {
    expect(canonicalJson({ b: 1, a: [{ d: null, c: 'x' }], e: undefined })).toBe('{"a":[{"c":"x","d":null}],"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});
