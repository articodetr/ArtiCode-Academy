// TEST-123 (unit) — the smallest-diff planning of an assignment PATCH (MOD-08-T02).
import { describe, expect, it } from 'vitest';
import { isEmptyAssignmentPatch, latePolicyProblem, planAssignmentUpdate, toDecimalText } from './assignments.changes.js';
import type { AssignmentValues } from './assignments.changes.js';

const CURRENT: AssignmentValues = {
  title: { ar: 'واجب', en: 'Homework' },
  instructions: null,
  lessonId: null,
  maxScore: '20.00',
  weight: '10.00',
  dueAt: '2026-11-20T20:59:00.000Z',
  allowLate: true,
  latePenaltyPercent: '5.00',
  maxAttempts: 2,
};

describe('toDecimalText / isEmptyAssignmentPatch', () => {
  it('writes decimals with two places and keeps null', () => {
    expect(toDecimalText(20)).toBe('20.00');
    expect(toDecimalText(12.5)).toBe('12.50');
    expect(toDecimalText('7.1')).toBe('7.10');
    expect(toDecimalText(null)).toBeNull();
  });

  it('recognises an empty body only', () => {
    expect(isEmptyAssignmentPatch({})).toBe(true);
    expect(isEmptyAssignmentPatch({ weight: null })).toBe(false);
  });
});

describe('planAssignmentUpdate', () => {
  it('writes only the fields whose value changes, comparing decimals as text and texts by locale', () => {
    const plan = planAssignmentUpdate(CURRENT, {
      title: { ar: 'واجب', en: 'Homework' },
      maxScore: '20.00',
      weight: null,
      dueAt: '2026-11-20T20:59:00.000Z',
      maxAttempts: 3,
      instructions: { ar: 'حلّ التمارين' },
    });
    expect(plan.fields).toEqual(['instructions', 'weight', 'maxAttempts']);
    expect(plan.data).toEqual({ instructions: { ar: 'حلّ التمارين' }, weight: null, maxAttempts: 3 });
  });

  it('returns no field for an identical body', () => {
    expect(planAssignmentUpdate(CURRENT, { ...CURRENT }).fields).toEqual([]);
  });
});

describe('latePolicyProblem', () => {
  it('refuses a penalty without allowLate after the merge, and accepts clearing both', () => {
    expect(latePolicyProblem(CURRENT, { allowLate: false })).toEqual({ allowLate: false, latePenaltyPercent: 5 });
    expect(latePolicyProblem(CURRENT, { allowLate: false, latePenaltyPercent: null })).toBeNull();
    expect(latePolicyProblem({ allowLate: false, latePenaltyPercent: null }, { latePenaltyPercent: '10.00' })).toEqual({ allowLate: false, latePenaltyPercent: 10 });
    expect(latePolicyProblem(CURRENT, { latePenaltyPercent: '0.00' })).toBeNull();
  });
});
