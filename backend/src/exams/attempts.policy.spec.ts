// TEST-283 (unit part) — the pure rules of an attempt: the deadline, the take state, the release of results (D-R152..D-R157).
import { describe, expect, it } from 'vitest';
import { ATTEMPT_GRACE_MS, attemptDeadline, isAttemptOver, isResultReleased, isReviewReleased, remainingSeconds, takeState } from './attempts.policy.js';
import type { AttemptState, ReleaseSettings, TakeInput } from './attempts.policy.js';

const OPENS = new Date('2026-12-01T08:00:00.000Z');
const CLOSES = new Date('2026-12-01T10:00:00.000Z');
const at = (time: string) => new Date(`2026-12-01T${time}Z`);

describe('the deadline of an attempt (D-R152)', () => {
  it('is the start plus the time limit, cut at the end of the window', () => {
    expect(attemptDeadline(at('08:10:00.000'), 30, CLOSES)).toEqual(at('08:40:00.000'));
    expect(attemptDeadline(at('09:45:00.000'), 30, CLOSES)).toEqual(CLOSES);
    expect(attemptDeadline(at('09:30:00.000'), 30, CLOSES)).toEqual(CLOSES);
  });

  it('takes a write up to the network allowance after the deadline, and not a millisecond more', () => {
    const expiresAt = at('08:40:00.000');
    expect(isAttemptOver(expiresAt, at('08:39:59.999'))).toBe(false);
    expect(isAttemptOver(expiresAt, expiresAt)).toBe(false);
    expect(isAttemptOver(expiresAt, new Date(expiresAt.getTime() + ATTEMPT_GRACE_MS - 1))).toBe(false);
    expect(isAttemptOver(expiresAt, new Date(expiresAt.getTime() + ATTEMPT_GRACE_MS))).toBe(true);
  });

  it('shows the learner whole seconds of the official deadline, never a negative number', () => {
    const expiresAt = at('08:40:00.000');
    expect(remainingSeconds(expiresAt, at('08:10:00.000'))).toBe(1800);
    expect(remainingSeconds(expiresAt, at('08:39:59.001'))).toBe(1);
    expect(remainingSeconds(expiresAt, expiresAt)).toBe(0);
    expect(remainingSeconds(expiresAt, at('08:45:00.000'))).toBe(0);
  });
});

describe('takeState()', () => {
  const base: TakeInput = { relation: 'self', mayTake: true, examStatus: 'scheduled', classStatus: 'running', enrollmentStatus: 'active', scheduledAt: OPENS, closesAt: CLOSES, attemptsAllowed: 2, attempts: [], now: at('08:30:00.000') };
  const attempt = (over: Partial<AttemptState>): AttemptState => ({ id: 'a1', attemptNo: 1, status: 'submitted', expiresAt: at('08:40:00.000'), ...over });

  it('lets an enrolled learner start the first attempt inside the window', () => {
    expect(takeState(base)).toEqual({ canStart: true, blocker: null, inProgress: null, attemptsUsed: 0, nextAttemptNo: 1 });
  });

  it('resumes the attempt in progress instead of starting another', () => {
    const live = attempt({ status: 'in_progress' });
    expect(takeState({ ...base, attempts: [live] })).toEqual({ canStart: true, blocker: null, inProgress: live, attemptsUsed: 1, nextAttemptNo: null });
    // …even on the last allowed attempt.
    expect(takeState({ ...base, attemptsAllowed: 1, attempts: [live] })).toMatchObject({ canStart: true, inProgress: live });
  });

  it('counts an attempt whose time is up as used, and offers the next one while one is left', () => {
    const over = attempt({ status: 'in_progress', expiresAt: at('08:20:00.000') });
    expect(takeState({ ...base, attempts: [over] })).toEqual({ canStart: true, blocker: null, inProgress: null, attemptsUsed: 1, nextAttemptNo: 2 });
    expect(takeState({ ...base, attemptsAllowed: 1, attempts: [over] })).toMatchObject({ canStart: false, blocker: 'attempts_exhausted', attemptsUsed: 1 });
    expect(takeState({ ...base, attempts: [attempt({}), attempt({ id: 'a2', attemptNo: 2, status: 'timed_out' })] })).toMatchObject({ canStart: false, blocker: 'attempts_exhausted', attemptsUsed: 2, nextAttemptNo: null });
  });

  it('names why the exam cannot be taken, in a fixed order', () => {
    expect(takeState({ ...base, relation: 'child' })).toMatchObject({ canStart: false, blocker: 'not_self' });
    // A learner whose role lacks `exams.take` is told so before anything about the exam.
    expect(takeState({ ...base, mayTake: false })).toMatchObject({ canStart: false, blocker: 'not_permitted' });
    expect(takeState({ ...base, mayTake: false, examStatus: 'published' }).blocker).toBe('not_permitted');
    expect(takeState({ ...base, mayTake: false, relation: 'child' }).blocker).toBe('not_self');
    expect(takeState({ ...base, examStatus: 'published' })).toMatchObject({ blocker: 'results_published' });
    for (const enrollmentStatus of ['completed', 'withdrawn', 'cancelled', 'pending', null] as const) {
      expect(takeState({ ...base, enrollmentStatus }), String(enrollmentStatus)).toMatchObject({ canStart: false, blocker: 'not_enrolled' });
    }
    expect(takeState({ ...base, classStatus: 'cancelled' })).toMatchObject({ blocker: 'class_closed' });
    expect(takeState({ ...base, now: at('07:59:59.999') })).toMatchObject({ blocker: 'not_open_yet' });
    expect(takeState({ ...base, now: CLOSES })).toMatchObject({ blocker: 'closed' });
    // The order: a guardian's item of a published exam is first of all not theirs to take.
    expect(takeState({ ...base, relation: 'child', examStatus: 'published', enrollmentStatus: null }).blocker).toBe('not_self');
    expect(takeState({ ...base, examStatus: 'published', enrollmentStatus: 'completed', now: CLOSES }).blocker).toBe('results_published');
    expect(takeState({ ...base, enrollmentStatus: 'completed', now: CLOSES }).blocker).toBe('not_enrolled');
  });

  it('never resumes an attempt for somebody who may not take the exam any more', () => {
    const live = attempt({ status: 'in_progress' });
    expect(takeState({ ...base, enrollmentStatus: 'withdrawn', attempts: [live] })).toMatchObject({ canStart: false, blocker: 'not_enrolled', inProgress: null });
    expect(takeState({ ...base, classStatus: 'cancelled', attempts: [live] })).toMatchObject({ canStart: false, blocker: 'class_closed', inProgress: null });
  });
});

describe('what a learner sees (D-R156, D-R157)', () => {
  const online: ReleaseSettings = { status: 'scheduled', delivery: 'online', resultsRelease: 'on_publish', revealAnswers: true, closesAt: CLOSES };

  it('releases a manual exam’s result on publish only, as before', () => {
    expect(isResultReleased({ status: 'scheduled', delivery: 'manual', resultsRelease: 'on_publish' })).toBe(false);
    expect(isResultReleased({ status: 'published', delivery: 'manual', resultsRelease: 'on_publish' })).toBe(true);
    // Whatever the column says, a manual exam never releases on submit.
    expect(isResultReleased({ status: 'scheduled', delivery: 'manual', resultsRelease: 'on_submit' })).toBe(false);
  });

  it('releases an online result on publish, or at once when the exam says so', () => {
    expect(isResultReleased(online)).toBe(false);
    expect(isResultReleased({ ...online, status: 'published' })).toBe(true);
    expect(isResultReleased({ ...online, resultsRelease: 'on_submit' })).toBe(true);
  });

  it('reveals the answers only when the exam allows it, the result is out and no attempt takes a write any more', () => {
    // The window closes at 10:00:00; a last write is still taken until 10:00:05 (the network allowance).
    const after = new Date(CLOSES.getTime() + ATTEMPT_GRACE_MS);
    const before = new Date(CLOSES.getTime() + ATTEMPT_GRACE_MS - 1);
    expect(isReviewReleased({ ...online, status: 'published' }, CLOSES)).toBe(false);
    expect(isReviewReleased({ ...online, status: 'published' }, after)).toBe(true);
    expect(isReviewReleased({ ...online, resultsRelease: 'on_submit' }, after)).toBe(true);
    // A learner who finished early sees the score at once, the key only after everybody is out.
    expect(isReviewReleased({ ...online, resultsRelease: 'on_submit' }, before)).toBe(false);
    expect(isReviewReleased(online, after)).toBe(false);
    expect(isReviewReleased({ ...online, status: 'published', revealAnswers: false }, after)).toBe(false);
    expect(isReviewReleased({ ...online, status: 'published', closesAt: null }, after)).toBe(false);
    expect(isReviewReleased({ ...online, status: 'published', delivery: 'manual' }, after)).toBe(false);
  });
});
