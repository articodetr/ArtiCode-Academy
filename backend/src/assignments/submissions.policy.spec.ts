// TEST-124 (unit) — the submission window, attempt counting and review rules of MOD-08-T03.
import { describe, expect, it } from 'vitest';
import { isScoreInRange, reviewTarget, reviewVersionMatches, sameReview, submissionWindow, submitState, summarizeAttempts } from './submissions.policy.js';

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

// MOD-08-T07 (D-R49) — contract follow-ups.
describe('submitState', () => {
  it('blocks in the order of API-109: enrollment, window, attempts; otherwise says whether the attempt would be late', () => {
    expect(submitState('completed', { isLate: false }, 0, 1)).toEqual({ blocker: 'not_enrolled', late: false });
    expect(submitState(null, { closed: 'closed' }, 0, 1)).toEqual({ blocker: 'not_enrolled', late: false });
    expect(submitState('active', { closed: 'past_due' }, 1, 1)).toEqual({ blocker: 'past_due', late: false });
    expect(submitState('active', { closed: 'closed' }, 0, 1)).toEqual({ blocker: 'closed', late: false });
    expect(submitState('active', { isLate: true }, 2, 2)).toEqual({ blocker: 'attempts_exhausted', late: false });
    expect(submitState('active', { isLate: true }, 1, 2)).toEqual({ blocker: null, late: true });
    expect(submitState('active', { isLate: false }, 0, 1)).toEqual({ blocker: null, late: false });
  });
});

describe('reviewVersionMatches', () => {
  it('checks nothing without expectedGradedAt; null expects no review yet; an instant must be the last review', () => {
    const at = new Date('2026-11-10T16:40:12.345Z');
    expect(reviewVersionMatches(undefined, at)).toBe(true);
    expect(reviewVersionMatches(undefined, null)).toBe(true);
    expect(reviewVersionMatches(null, null)).toBe(true);
    expect(reviewVersionMatches(null, at)).toBe(false);
    expect(reviewVersionMatches('2026-11-10T16:40:12.345Z', at)).toBe(true);
    expect(reviewVersionMatches('2026-11-10T19:40:12.345+03:00', at)).toBe(true); // the same instant with an offset
    expect(reviewVersionMatches('2026-11-10T16:40:12.346Z', at)).toBe(false);
    expect(reviewVersionMatches('2026-11-10T16:40:12.345Z', null)).toBe(false);
  });
});
