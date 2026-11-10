// TEST-130 (unit) — the results-sheet rules of MOD-09-T04 (D-R45/D-R47).
import { describe, expect, it } from 'vitest';
import { duplicateStudents, isEmptyResultsPlan, planResultsBatch, resultsBlocker, scoreAboveMax } from './exam-results.changes.js';
import type { ResultEntry, ResultValues } from './exam-results.changes.js';
import { visibleResult } from './my-exams.policy.js';

describe('resultsBlocker / duplicateStudents / scoreAboveMax', () => {
  it('takes results for a scheduled or published exam of a class that is not cancelled', () => {
    expect(resultsBlocker('running', 'scheduled')).toBeNull();
    expect(resultsBlocker('completed', 'published')).toBeNull(); // corrections after the class ended
    expect(resultsBlocker('open', 'draft')).toBe('not_scheduled');
    expect(resultsBlocker('cancelled', 'published')).toBe('class_cancelled');
    expect(resultsBlocker('cancelled', 'draft')).toBe('class_cancelled'); // the class first
  });

  it('finds repeated students and the first score above the maximum', () => {
    expect(duplicateStudents(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b']);
    expect(duplicateStudents(['a', 'b'])).toEqual([]);
    const entries: ResultEntry[] = [
      { studentId: 'a', status: 'scored', score: '20.00', feedback: null },
      { studentId: 'b', status: 'absent', score: null, feedback: null },
      { studentId: 'c', status: 'scored', score: '20.01', feedback: null },
    ];
    expect(scoreAboveMax(entries, 20)).toMatchObject({ studentId: 'c' });
    expect(scoreAboveMax(entries, 25)).toBeNull();
  });
});

describe('planResultsBatch', () => {
  it('creates missing results, updates the changed fields and leaves identical ones alone', () => {
    const existing = new Map<string, ResultValues>([
      ['a', { status: 'scored', score: '15.00', feedback: 'جيد' }],
      ['b', { status: 'absent', score: null, feedback: null }],
    ]);
    const plan = planResultsBatch(existing, [
      { studentId: 'a', status: 'scored', score: '15.00', feedback: null }, // feedback cleared
      { studentId: 'b', status: 'absent', score: null, feedback: null }, // identical
      { studentId: 'c', status: 'excused', score: null, feedback: 'عذر طبي' },
    ]);
    expect(plan.created).toEqual([{ studentId: 'c', status: 'excused', score: null, feedback: 'عذر طبي' }]);
    expect(plan.updated).toEqual([{ studentId: 'a', data: { status: 'scored', score: '15.00', feedback: null }, fields: ['feedback'] }]);
    expect(plan.unchanged).toEqual(['b']);
    expect(isEmptyResultsPlan(plan)).toBe(false);
    expect(isEmptyResultsPlan(planResultsBatch(existing, [{ studentId: 'b', status: 'absent', score: null, feedback: null }]))).toBe(true);
  });
});

describe('visibleResult («my exams»)', () => {
  it('shows a learner their result only once the results are published', () => {
    const result = { status: 'scored' as const, score: 18, feedback: 'ممتاز' };
    expect(visibleResult('published', result)).toEqual(result);
    expect(visibleResult('scheduled', result)).toBeNull();
    expect(visibleResult('published', null)).toBeNull();
  });
});
