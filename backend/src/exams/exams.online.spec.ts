// TEST-282 (unit part) — the pure rules of the online side of an exam (D-R150..D-R159).
import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import {
  MANUAL_SETTINGS,
  buildSnapshot,
  changedOnlineFields,
  duplicateQuestionIds,
  examReadiness,
  isEmptyOnlinePatch,
  isWindowInverted,
  lockedOnlineFields,
  mergeOnline,
  onlineFieldsOnManual,
  planExamQuestions,
  planKeyCorrection,
  readSnapshot,
  sumPoints,
  windowStateOf,
} from './exams.online.js';
import type { OnlineLockValues, OnlineValues, QuestionSnapshot } from './exams.online.js';

const OPENS = '2026-12-01T08:00:00.000Z';
const CLOSES = '2026-12-01T10:00:00.000Z';
const manual: OnlineValues = { delivery: 'manual', ...MANUAL_SETTINGS };
const online: OnlineValues = { delivery: 'online', closesAt: CLOSES, attemptsAllowed: 2, resultsRelease: 'on_submit', revealAnswers: true };

describe('the online settings of an exam (D-R150)', () => {
  it('keeps a manual exam on the defaults and resets an online draft that turns manual', () => {
    expect(mergeOnline(manual, {})).toEqual(manual);
    expect(mergeOnline(manual, { delivery: 'online' })).toEqual({ delivery: 'online', ...MANUAL_SETTINGS });
    expect(mergeOnline(manual, { delivery: 'online', closesAt: CLOSES, attemptsAllowed: 3 })).toEqual({ ...manual, delivery: 'online', closesAt: CLOSES, attemptsAllowed: 3 });
    expect(mergeOnline(online, { delivery: 'manual' })).toEqual(manual);
    expect(mergeOnline(online, { revealAnswers: false, closesAt: null })).toEqual({ ...online, revealAnswers: false, closesAt: null });
  });

  it('names the online-only settings a manual exam was given, defaults excepted', () => {
    expect(onlineFieldsOnManual('manual', { closesAt: CLOSES, attemptsAllowed: 2, resultsRelease: 'on_submit', revealAnswers: true })).toEqual(['closesAt', 'attemptsAllowed', 'resultsRelease', 'revealAnswers']);
    expect(onlineFieldsOnManual('manual', { closesAt: null, attemptsAllowed: 1, resultsRelease: 'on_publish', revealAnswers: false })).toEqual([]);
    expect(onlineFieldsOnManual('manual', {})).toEqual([]);
    expect(onlineFieldsOnManual('online', { closesAt: CLOSES, attemptsAllowed: 5 })).toEqual([]);
  });

  it('lists the settings that really change, in catalogue order', () => {
    expect(changedOnlineFields(online, online)).toEqual([]);
    expect(changedOnlineFields(manual, mergeOnline(manual, { delivery: 'online', revealAnswers: true }))).toEqual(['delivery', 'revealAnswers']);
    expect(changedOnlineFields(online, manual)).toEqual(['delivery', 'closesAt', 'attemptsAllowed', 'resultsRelease', 'revealAnswers']);
    expect(isEmptyOnlinePatch({})).toBe(true);
    expect(isEmptyOnlinePatch({ revealAnswers: false })).toBe(false);
  });

  it('refuses a window that closes at or before it opens', () => {
    expect(isWindowInverted(OPENS, CLOSES)).toBe(false);
    expect(isWindowInverted(OPENS, OPENS)).toBe(true);
    expect(isWindowInverted(CLOSES, OPENS)).toBe(true);
    expect(isWindowInverted(null, CLOSES)).toBe(false);
    expect(isWindowInverted(OPENS, null)).toBe(false);
  });
});

describe('lockedOnlineFields()', () => {
  const values: OnlineLockValues = { scheduledAt: OPENS, closesAt: CLOSES, durationMinutes: 30, attemptsAllowed: 2 };

  it('refuses a manual exam nothing here, and changes the delivery in a draft only', () => {
    expect(lockedOnlineFields({ status: 'published', delivery: 'manual', attemptCount: 0 }, values, { maxScore: '20.00', scheduledAt: null, durationMinutes: null })).toEqual([]);
    expect(lockedOnlineFields({ status: 'draft', delivery: 'manual', attemptCount: 0 }, values, { delivery: 'online' })).toEqual([]);
    expect(lockedOnlineFields({ status: 'draft', delivery: 'online', attemptCount: 0 }, values, { delivery: 'manual', maxScore: '5.00', closesAt: null })).toEqual([]);
    for (const status of ['scheduled', 'published'] as const) {
      expect(lockedOnlineFields({ status, delivery: 'manual', attemptCount: 0 }, values, { delivery: 'online' })).toEqual(['delivery']);
      expect(lockedOnlineFields({ status, delivery: 'online', attemptCount: 0 }, values, { delivery: 'manual' })).toEqual(['delivery']);
    }
  });

  it('freezes the maximum score of an online exam the learners see, and keeps its window and time limit present', () => {
    const state = { status: 'scheduled', delivery: 'online', attemptCount: 0 } as const;
    expect(lockedOnlineFields(state, values, { maxScore: '20.00' })).toEqual(['maxScore']);
    expect(lockedOnlineFields(state, values, { scheduledAt: null, closesAt: null, durationMinutes: null })).toEqual(['scheduledAt', 'closesAt', 'durationMinutes']);
    // Without an attempt the window and the limit still move freely, and the attempts go either way.
    expect(lockedOnlineFields(state, values, { scheduledAt: '2026-12-01T07:00:00.000Z', closesAt: '2026-12-01T09:00:00.000Z', durationMinutes: 20, attemptsAllowed: 1 })).toEqual([]);
  });

  it('once somebody has started: the opening and the limit are fixed, the window only moves later and the attempts only rise', () => {
    const state = { status: 'scheduled', delivery: 'online', attemptCount: 1 } as const;
    expect(lockedOnlineFields(state, values, { scheduledAt: '2026-12-01T07:00:00.000Z', durationMinutes: 45, attemptsAllowed: 1, closesAt: '2026-12-01T09:59:59.000Z' })).toEqual([
      'scheduledAt',
      'closesAt',
      'durationMinutes',
      'attemptsAllowed',
    ]);
    expect(lockedOnlineFields(state, values, { closesAt: '2026-12-01T12:00:00.000Z', attemptsAllowed: 3 })).toEqual([]);
    expect(lockedOnlineFields({ ...state, status: 'published' }, values, { closesAt: '2026-12-02T10:00:00.000Z' })).toEqual([]);
  });
});

describe('windowStateOf()', () => {
  const opens = new Date(OPENS);
  const closes = new Date(CLOSES);

  it('is open from the opening instant up to, not including, the closing one', () => {
    expect(windowStateOf(opens, closes, new Date('2026-12-01T07:59:59.999Z'))).toBe('not_open');
    expect(windowStateOf(opens, closes, opens)).toBe('open');
    expect(windowStateOf(opens, closes, new Date('2026-12-01T09:59:59.999Z'))).toBe('open');
    expect(windowStateOf(opens, closes, closes)).toBe('closed');
    expect(windowStateOf(null, closes, opens)).toBe('not_open');
    expect(windowStateOf(opens, null, opens)).toBe('not_open');
  });
});

describe('examReadiness() — D-R159', () => {
  const now = new Date('2026-11-30T12:00:00.000Z');
  const base = { scheduledAt: new Date(OPENS), closesAt: new Date(CLOSES), durationMinutes: 30, maxScore: '10.00', now };
  const ready = (id: string, points: string) => ({ questionId: id, status: 'ready' as const, points });

  it('is ready with ready questions whose points sum to the maximum score', () => {
    const readiness = examReadiness({ ...base, questions: [ready('a', '2.00'), ready('b', '2.00'), ready('c', '2.00'), ready('d', '2.00'), ready('e', '2.00')] });
    expect(readiness).toEqual({ problems: [], totalPoints: '10.00', notReady: [] });
  });

  it('names every problem at once, in catalogue order', () => {
    expect(examReadiness({ ...base, questions: [] }).problems).toEqual(['no_questions']);
    expect(examReadiness({ scheduledAt: null, closesAt: null, durationMinutes: null, maxScore: '10.00', now, questions: [] }).problems).toEqual(['no_questions', 'window_missing', 'duration_missing']);
    const readiness = examReadiness({ ...base, questions: [ready('a', '4.00'), { questionId: 'b', status: 'draft', points: '4.00' }, { questionId: 'c', status: 'archived', points: '1.00' }] });
    expect(readiness).toEqual({ problems: ['questions_not_ready', 'points_mismatch'], totalPoints: '9.00', notReady: ['b', 'c'] });
    expect(examReadiness({ ...base, now: new Date(CLOSES), questions: [ready('a', '10.00')] }).problems).toEqual(['window_closed']);
  });

  it('adds points as decimals, never as floats', () => {
    expect(sumPoints(['0.10', '0.20'])).toBe('0.30');
    expect(sumPoints([])).toBe('0.00');
    expect(sumPoints(Array.from({ length: 10 }, () => '0.10'))).toBe('1.00');
    expect(examReadiness({ ...base, maxScore: '0.30', questions: [ready('a', '0.10'), ready('b', '0.20')] }).problems).toEqual([]);
    expect(examReadiness({ ...base, maxScore: '10.00', questions: [ready('a', '3.33'), ready('b', '3.33'), ready('c', '3.33')] })).toMatchObject({ problems: ['points_mismatch'], totalPoints: '9.99' });
    expect(new Prisma.Decimal(sumPoints(['9999.99', '0.01'])).toFixed(2)).toBe('10000.00');
  });
});

describe('planExamQuestions()', () => {
  const current = [
    { questionId: 'a', points: '2.00' },
    { questionId: 'b', points: '2.00' },
    { questionId: 'c', points: '2.00' },
  ];

  it('changes nothing for the same ordered list', () => {
    expect(planExamQuestions(current, current.map((entry) => ({ ...entry })))).toEqual({ changed: false, added: [], removed: [], repointed: [], reordered: false });
    expect(planExamQuestions([], [])).toMatchObject({ changed: false });
  });

  it('tells what was added, removed, given other points or moved', () => {
    expect(planExamQuestions(current, [{ questionId: 'c', points: '2.00' }, { questionId: 'a', points: '3.50' }, { questionId: 'd', points: '1.00' }])).toEqual({
      changed: true,
      added: ['d'],
      removed: ['b'],
      repointed: ['a'],
      reordered: true,
    });
    // Removing a question from the middle is not a reordering of the ones that stay.
    expect(planExamQuestions(current, [current[0]!, current[2]!])).toEqual({ changed: true, added: [], removed: ['b'], repointed: [], reordered: false });
    expect(planExamQuestions(current, [current[1]!, current[0]!, current[2]!])).toMatchObject({ changed: true, reordered: true, added: [], removed: [] });
    expect(planExamQuestions(current, [])).toMatchObject({ changed: true, removed: ['a', 'b', 'c'] });
  });

  it('finds a question named twice', () => {
    expect(duplicateQuestionIds(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b']);
    expect(duplicateQuestionIds(['a', 'b'])).toEqual([]);
  });
});

describe('the frozen copy (D-R158)', () => {
  const choice = {
    type: 'single_choice' as const,
    prompt: { ar: 'ما ناتج print(2 + 3)؟', en: 'What does print(2 + 3) output?' },
    explanation: { ar: 'الجمع' },
    correctBoolean: null,
    options: [
      { id: 'o1', text: { ar: '4' }, isCorrect: false },
      { id: 'o2', text: { ar: '5' }, isCorrect: true },
    ],
  };

  it('copies the whole question, key included, and reads it back unchanged', () => {
    const snapshot = buildSnapshot(choice);
    expect(snapshot).toEqual({ type: 'single_choice', prompt: choice.prompt, explanation: { ar: 'الجمع' }, options: choice.options, correctBoolean: null });
    expect(readSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    const trueFalse = buildSnapshot({ type: 'true_false', prompt: { ar: 'بايثون لغة برمجة' }, explanation: null, correctBoolean: false, options: [] });
    expect(trueFalse).toEqual({ type: 'true_false', prompt: { ar: 'بايثون لغة برمجة' }, explanation: null, options: [], correctBoolean: false });
    expect(readSnapshot(JSON.parse(JSON.stringify(trueFalse)))).toEqual(trueFalse);
  });

  it('never carries a boolean key for a choice question, and does not share memory with its source', () => {
    const snapshot = buildSnapshot({ ...choice, correctBoolean: true });
    expect(snapshot.correctBoolean).toBeNull();
    expect(snapshot.options).not.toBe(choice.options);
    expect(snapshot.options[0]).not.toBe(choice.options[0]);
  });

  it('reads anything that is not a snapshot as null', () => {
    for (const value of [null, undefined, 'x', [], {}, { type: 'essay', prompt: { ar: 'س' }, options: [] }, { type: 'true_false', prompt: { en: 'q' }, options: [] }, { type: 'true_false', prompt: { ar: 'س' } }, { type: 'single_choice', prompt: { ar: 'س' }, options: [{ id: 1, text: { ar: 'أ' }, isCorrect: true }] }]) {
      expect(readSnapshot(value)).toBeNull();
    }
  });
});

describe('planKeyCorrection() — D-R161', () => {
  const by = { userId: 'u-teacher', at: '2026-12-02T09:00:00.000Z', reason: 'المفتاح كان خاطئًا' };
  const choice: QuestionSnapshot = {
    type: 'single_choice',
    prompt: { ar: 'ما نوع القيمة 3.14؟' },
    explanation: null,
    options: [
      { id: 'o-int', text: { ar: 'int' }, isCorrect: false },
      { id: 'o-float', text: { ar: 'float' }, isCorrect: true },
      { id: 'o-str', text: { ar: 'str' }, isCorrect: false },
    ],
    correctBoolean: null,
  };
  const trueFalse: QuestionSnapshot = { type: 'true_false', prompt: { ar: 'القوائم غير قابلة للتعديل.' }, explanation: { ar: 'القوائم قابلة للتعديل' }, options: [], correctBoolean: false };

  it('moves the key of a choice question to another of its own options and keeps the previous one in the copy’s history', () => {
    const plan = planKeyCorrection(choice, { correctOptionId: 'o-int' }, by);
    expect(plan).toMatchObject({ ok: true, changed: true });
    if (!plan.ok || !plan.changed) throw new Error('unreachable');
    expect(plan.next.options.map((option) => [option.id, option.isCorrect])).toEqual([['o-int', true], ['o-float', false], ['o-str', false]]);
    expect(plan.next.corrections).toEqual([{ at: by.at, byUserId: 'u-teacher', previousOptionId: 'o-float', previousBoolean: null, reason: by.reason }]);
    // Everything else of the copy is untouched, and the input is not mutated.
    expect(plan.next).toMatchObject({ type: 'single_choice', prompt: choice.prompt, explanation: null, correctBoolean: null });
    expect(choice.options[1]!.isCorrect).toBe(true);
    expect(choice.corrections).toBeUndefined();
  });

  it('flips the key of a true/false question', () => {
    const plan = planKeyCorrection(trueFalse, { correctAnswer: true }, by);
    if (!plan.ok || !plan.changed) throw new Error('unreachable');
    expect(plan.next).toMatchObject({ correctBoolean: true, options: [], explanation: trueFalse.explanation });
    expect(plan.next.corrections).toEqual([{ at: by.at, byUserId: 'u-teacher', previousOptionId: null, previousBoolean: false, reason: by.reason }]);
  });

  it('appends to the history, oldest first, and survives the round trip through the stored JSON', () => {
    const first = planKeyCorrection(choice, { correctOptionId: 'o-int' }, by);
    if (!first.ok || !first.changed) throw new Error('unreachable');
    const stored = readSnapshot(JSON.parse(JSON.stringify(first.next)));
    expect(stored).toEqual(first.next);
    const second = planKeyCorrection(stored!, { correctOptionId: 'o-str' }, { ...by, at: '2026-12-03T09:00:00.000Z', reason: 'تصحيح ثانٍ' });
    if (!second.ok || !second.changed) throw new Error('unreachable');
    expect(second.next.corrections!.map((entry) => [entry.previousOptionId, entry.reason])).toEqual([['o-float', by.reason], ['o-int', 'تصحيح ثانٍ']]);
    expect(second.next.options.filter((option) => option.isCorrect).map((option) => option.id)).toEqual(['o-str']);
  });

  it('changes nothing when the request names the key the question already has', () => {
    expect(planKeyCorrection(choice, { correctOptionId: 'o-float' }, by)).toEqual({ ok: true, changed: false });
    expect(planKeyCorrection(trueFalse, { correctAnswer: false }, by)).toEqual({ ok: true, changed: false });
  });

  it('refuses a key that does not fit the question', () => {
    expect(planKeyCorrection(choice, {}, by)).toEqual({ ok: false, problem: 'option_required' });
    expect(planKeyCorrection(choice, { correctOptionId: null }, by)).toEqual({ ok: false, problem: 'option_required' });
    expect(planKeyCorrection(choice, { correctOptionId: 'o-of-another-question' }, by)).toEqual({ ok: false, problem: 'option_unknown' });
    expect(planKeyCorrection(choice, { correctAnswer: true }, by)).toEqual({ ok: false, problem: 'not_allowed_for_type' });
    expect(planKeyCorrection(choice, { correctOptionId: 'o-int', correctAnswer: true }, by)).toEqual({ ok: false, problem: 'not_allowed_for_type' });
    expect(planKeyCorrection(trueFalse, {}, by)).toEqual({ ok: false, problem: 'answer_required' });
    expect(planKeyCorrection(trueFalse, { correctAnswer: null }, by)).toEqual({ ok: false, problem: 'answer_required' });
    expect(planKeyCorrection(trueFalse, { correctOptionId: 'o-int' }, by)).toEqual({ ok: false, problem: 'not_allowed_for_type' });
  });

  it('ignores a malformed history entry in a stored copy instead of failing on it', () => {
    const stored = readSnapshot({ ...choice, corrections: [{ at: by.at }, 'nonsense', { at: by.at, byUserId: 'u', reason: 'r', previousOptionId: 'o-float' }] });
    expect(stored!.corrections).toEqual([{ at: by.at, byUserId: 'u', previousOptionId: 'o-float', previousBoolean: null, reason: 'r' }]);
    expect(readSnapshot({ ...choice, corrections: 'nonsense' })!.corrections).toBeUndefined();
  });
});
