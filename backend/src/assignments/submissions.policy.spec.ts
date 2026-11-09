// TEST-124 (unit) — the submission window, attempt counting and review rules of MOD-08-T03.
import { describe, expect, it } from 'vitest';
import { isScoreInRange, reviewTarget, sameReview, submissionWindow, summarizeAttempts } from './submissions.policy.js';

describe('submissionWindow', () => {
  const due = new Date('2026-11-20T20:59:00Z');
  it('takes submissions for an open assignment only, on time before the due date and late after it with allowLate (D-R38)', () => {
    expect(submissionWindow('draft', null, false)).toEqual({ closed: 'not_published' });
    expect(submissionWindow('closed', null, true)).toEqual({ closed: 'closed' });
    expect(submissionWindow('grading', null, true)).toEqual({ closed: 'closed' });
    expect(submissionWindow('open', null, false)).toEqual({ isLate: false });
    expect(submissionWindow('open', due, false, new Date('2026-11-20T20:59:00Z'))).toEqual({ isLate: false });
    expect(submissionWindow('open', due, false, new Date('2026-11-20T21:00:00Z'))).toEqual({ closed: 'past_due' });
    expect(submissionWindow('open', due, true, new Date('2026-11-20T21:00:00Z'))).toEqual({ isLate: true });
  });
});

describe('summarizeAttempts', () => {
  it('counts attempts, grants one more per returned attempt and keeps the latest graded score (D-R39)', () => {
    expect(summarizeAttempts([], 2)).toEqual({ attempts: 0, attemptsAllowed: 2, lastAttemptNo: 0, lastGradedScore: null });
    const rows = [
      { attemptNo: 1, status: 'graded' as const, score: '12.00' },
      { attemptNo: 2, status: 'returned' as const, score: null },
      { attemptNo: 3, status: 'graded' as const, score: '18.50' },
      { attemptNo: 4, status: 'submitted' as const, score: null },
    ];
    expect(summarizeAttempts(rows, 3)).toEqual({ attempts: 4, attemptsAllowed: 4, lastAttemptNo: 4, lastGradedScore: '18.50' });
  });
});

describe('reviewTarget / sameReview / isScoreInRange', () => {
  it('grades with a score and returns without one; an identical review is no change', () => {
    expect(reviewTarget('grade', '17.50', null)).toEqual({ status: 'graded', score: '17.50', feedback: null });
    expect(reviewTarget('return', '17.50', 'أعد السؤال الثاني')).toEqual({ status: 'returned', score: null, feedback: 'أعد السؤال الثاني' });
    const graded = { status: 'graded' as const, score: '17.50', feedback: 'جيد' };
    expect(sameReview(graded, { ...graded })).toBe(true);
    expect(sameReview(graded, { ...graded, feedback: null })).toBe(false);
    expect(sameReview(graded, { ...graded, score: '18.00' })).toBe(false);
    expect(isScoreInRange(0, 20)).toBe(true);
    expect(isScoreInRange(20, 20)).toBe(true);
    expect(isScoreInRange(20.01, 20)).toBe(false);
    expect(isScoreInRange(-0.5, 20)).toBe(false);
  });
});
