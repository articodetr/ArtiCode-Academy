// TEST-123 (unit) — the assignment state machine, delete rule and edit locks of MOD-08-T02.
import { describe, expect, it } from 'vitest';
import { actionNeedsOpenClass, allowedAssignmentActions, isAssignmentDeletable, lockedAssignmentFields, nextAssignmentStatus } from './assignments.status.js';

describe('nextAssignmentStatus / allowedAssignmentActions', () => {
  it('publishes a draft, closes an open assignment, reopens a closed one, and nothing else (D-R37)', () => {
    expect(nextAssignmentStatus('publish', 'draft')).toBe('open');
    expect(nextAssignmentStatus('close', 'open')).toBe('closed');
    expect(nextAssignmentStatus('reopen', 'closed')).toBe('open');
    expect(nextAssignmentStatus('publish', 'open')).toBeNull();
    expect(nextAssignmentStatus('close', 'draft')).toBeNull();
    expect(nextAssignmentStatus('reopen', 'open')).toBeNull();
    expect(nextAssignmentStatus('publish', 'grading')).toBeNull();
    expect(allowedAssignmentActions('draft')).toEqual(['publish']);
    expect(allowedAssignmentActions('open')).toEqual(['close']);
    expect(allowedAssignmentActions('closed')).toEqual(['reopen']);
    expect(allowedAssignmentActions('graded')).toEqual([]);
  });

  it('lets close end an assignment of a closed class; publish and reopen need an open class', () => {
    expect(actionNeedsOpenClass('close')).toBe(false);
    expect(actionNeedsOpenClass('publish')).toBe(true);
    expect(actionNeedsOpenClass('reopen')).toBe(true);
  });
});

describe('isAssignmentDeletable / lockedAssignmentFields', () => {
  it('deletes a draft without submissions only', () => {
    expect(isAssignmentDeletable('draft', 0)).toBe(true);
    expect(isAssignmentDeletable('draft', 1)).toBe(false);
    expect(isAssignmentDeletable('open', 0)).toBe(false);
    expect(isAssignmentDeletable('closed', 0)).toBe(false);
  });

  it('locks nothing before a submission, the grading rules after one, and everything of a closed assignment', () => {
    const requested = ['title', 'dueAt', 'maxScore', 'maxAttempts', 'allowLate', 'latePenaltyPercent', 'weight'];
    expect(lockedAssignmentFields('draft', 0, requested)).toEqual([]);
    expect(lockedAssignmentFields('open', 0, requested)).toEqual([]);
    expect(lockedAssignmentFields('open', 3, requested)).toEqual(['maxScore', 'maxAttempts', 'allowLate', 'latePenaltyPercent']);
    expect(lockedAssignmentFields('open', 3, ['title', 'dueAt', 'weight'])).toEqual([]);
    expect(lockedAssignmentFields('closed', 0, ['title'])).toEqual(['title']);
  });
});
