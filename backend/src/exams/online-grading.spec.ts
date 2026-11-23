// TEST-284 (unit part) — the auto-grading engine (D-R153, D-R159, D-R163).
import { describe, expect, it } from 'vitest';
import type { QuestionSnapshot } from './exams.online.js';
import { countedAttempt, gradeAttempt, isCorrectResponse, parseResponse, passOutcome } from './online-grading.js';
import type { GradableQuestion } from './online-grading.js';

const choice = (correctIndex: number, options = ['4', '5', '6', '23']): QuestionSnapshot => ({
  type: 'single_choice',
  prompt: { ar: 'ما ناتج print(2 + 3)؟' },
  explanation: null,
  options: options.map((text, index) => ({ id: `o${index}`, text: { ar: text }, isCorrect: index === correctIndex })),
  correctBoolean: null,
});
const trueFalse = (answer: boolean): QuestionSnapshot => ({ type: 'true_false', prompt: { ar: 'عبارة' }, explanation: null, options: [], correctBoolean: answer });

describe('parseResponse()', () => {
  it('takes one option of the question for a choice question, and nothing else', () => {
    expect(parseResponse(choice(1), { optionId: 'o1' })).toEqual({ ok: true, response: { optionId: 'o1' } });
    expect(parseResponse(choice(1), { optionId: 'o9' })).toEqual({ ok: false, problem: 'option_unknown' });
    expect(parseResponse(choice(1), {})).toEqual({ ok: false, problem: 'option_required' });
    expect(parseResponse(choice(1), { optionId: 1 })).toEqual({ ok: false, problem: 'option_required' });
    expect(parseResponse(choice(1), { value: true })).toEqual({ ok: false, problem: 'unexpected_field' });
    expect(parseResponse(choice(1), { optionId: 'o1', isCorrect: true })).toEqual({ ok: false, problem: 'unexpected_field' });
  });

  it('takes a boolean for a true/false question, and nothing else', () => {
    expect(parseResponse(trueFalse(true), { value: false })).toEqual({ ok: true, response: { value: false } });
    expect(parseResponse(trueFalse(true), { value: 'true' })).toEqual({ ok: false, problem: 'value_required' });
    expect(parseResponse(trueFalse(true), {})).toEqual({ ok: false, problem: 'value_required' });
    expect(parseResponse(trueFalse(true), { optionId: 'o0' })).toEqual({ ok: false, problem: 'unexpected_field' });
  });

  it('refuses anything that is not an object', () => {
    for (const raw of [null, undefined, 'o1', 1, true, ['o1']]) expect(parseResponse(choice(1), raw)).toEqual({ ok: false, problem: 'not_an_object' });
  });
});

describe('isCorrectResponse()', () => {
  it('compares with the frozen key', () => {
    expect(isCorrectResponse(choice(1), { optionId: 'o1' })).toBe(true);
    expect(isCorrectResponse(choice(1), { optionId: 'o0' })).toBe(false);
    expect(isCorrectResponse(choice(1), { value: true })).toBe(false);
    expect(isCorrectResponse(trueFalse(true), { value: true })).toBe(true);
    expect(isCorrectResponse(trueFalse(false), { value: true })).toBe(false);
    expect(isCorrectResponse(trueFalse(false), { value: false })).toBe(true);
    expect(isCorrectResponse(trueFalse(false), { optionId: 'o0' })).toBe(false);
  });
});

describe('gradeAttempt()', () => {
  /** Five questions worth two points each: four choices and one true/false. */
  const questions: GradableQuestion[] = [
    { id: 'q1', points: '2.00', snapshot: choice(1) },
    { id: 'q2', points: '2.00', snapshot: choice(0) },
    { id: 'q3', points: '2.00', snapshot: trueFalse(true) },
    { id: 'q4', points: '2.00', snapshot: trueFalse(false) },
    { id: 'q5', points: '2.00', snapshot: choice(2) },
  ];
  const answers = (entries: Record<string, unknown>) => new Map(Object.entries(entries));

  it('gives three right and two wrong answers out of five 6 of 10', () => {
    const grade = gradeAttempt(questions, answers({ q1: { optionId: 'o1' }, q2: { optionId: 'o0' }, q3: { value: true }, q4: { value: true }, q5: { optionId: 'o0' } }), '10.00');
    expect(grade.score).toBe('6.00');
    expect(grade.correctCount).toBe(3);
    expect(grade.answers).toEqual([
      { examQuestionId: 'q1', isCorrect: true, pointsAwarded: '2.00' },
      { examQuestionId: 'q2', isCorrect: true, pointsAwarded: '2.00' },
      { examQuestionId: 'q3', isCorrect: true, pointsAwarded: '2.00' },
      { examQuestionId: 'q4', isCorrect: false, pointsAwarded: '0.00' },
      { examQuestionId: 'q5', isCorrect: false, pointsAwarded: '0.00' },
    ]);
  });

  it('scores the two ends: nothing answered is 0, everything right is the maximum', () => {
    expect(gradeAttempt(questions, answers({}), '10.00')).toEqual({ score: '0.00', correctCount: 0, answers: [] });
    const all = gradeAttempt(questions, answers({ q1: { optionId: 'o1' }, q2: { optionId: 'o0' }, q3: { value: true }, q4: { value: false }, q5: { optionId: 'o2' } }), '10.00');
    expect(all.score).toBe('10.00');
    expect(all.correctCount).toBe(5);
  });

  it('leaves an unanswered question without an entry and without points', () => {
    const grade = gradeAttempt(questions, answers({ q3: { value: true } }), '10.00');
    expect(grade).toEqual({ score: '2.00', correctCount: 1, answers: [{ examQuestionId: 'q3', isCorrect: true, pointsAwarded: '2.00' }] });
  });

  it('counts a response that does not fit its question as wrong, and ignores an answer to a question the exam does not ask', () => {
    const grade = gradeAttempt(questions, answers({ q1: { value: true }, q2: { optionId: 'nope' }, q3: 'true', q9: { optionId: 'o1' } }), '10.00');
    expect(grade.score).toBe('0.00');
    expect(grade.correctCount).toBe(0);
    expect(grade.answers.map((answer) => answer.examQuestionId)).toEqual(['q1', 'q2', 'q3']);
  });

  it('adds weighted points as decimals and never passes the maximum', () => {
    const weighted: GradableQuestion[] = [
      { id: 'a', points: '0.10', snapshot: trueFalse(true) },
      { id: 'b', points: '0.20', snapshot: trueFalse(true) },
      { id: 'c', points: '3.35', snapshot: trueFalse(true) },
      { id: 'd', points: '6.35', snapshot: trueFalse(true) },
    ];
    const right = { value: true };
    expect(gradeAttempt(weighted, answers({ a: right, b: right }), '10.00').score).toBe('0.30');
    expect(gradeAttempt(weighted, answers({ a: right, b: right, c: right, d: right }), '10.00').score).toBe('10.00');
    // The points of a frozen exam sum to its maximum (D-R159); a larger sum could only come from bad data and is capped.
    expect(gradeAttempt(weighted, answers({ a: right, b: right, c: right, d: right }), '9.00').score).toBe('9.00');
    expect(gradeAttempt(weighted, answers({ c: right, d: { value: false } }), '10.00')).toMatchObject({ score: '3.35', correctCount: 1 });
  });
});

describe('countedAttempt() — D-R153', () => {
  it('counts the highest finished attempt, the earliest on a tie', () => {
    expect(countedAttempt([])).toBeNull();
    expect(countedAttempt([{ attemptNo: 1, score: '6.00' }])).toEqual({ attemptNo: 1, score: '6.00' });
    expect(countedAttempt([{ attemptNo: 1, score: '6.00' }, { attemptNo: 2, score: '8.50' }, { attemptNo: 3, score: '4.00' }])).toEqual({ attemptNo: 2, score: '8.50' });
    expect(countedAttempt([{ attemptNo: 2, score: '8.00' }, { attemptNo: 1, score: '8.00' }, { attemptNo: 3, score: '8.00' }])).toEqual({ attemptNo: 1, score: '8.00' });
    // Decimal comparison, not text: 10.00 beats 9.50.
    expect(countedAttempt([{ attemptNo: 1, score: '9.50' }, { attemptNo: 2, score: '10.00' }])).toEqual({ attemptNo: 2, score: '10.00' });
    expect(countedAttempt([{ attemptNo: 1, score: '0.00' }])).toEqual({ attemptNo: 1, score: '0.00' });
  });
});

describe('passOutcome()', () => {
  it('compares with the pass score, and says nothing when the exam names none', () => {
    expect(passOutcome('6.00', '6.00')).toBe(true);
    expect(passOutcome('5.99', '6.00')).toBe(false);
    expect(passOutcome('10.00', '9.50')).toBe(true);
    expect(passOutcome('0.00', '0.00')).toBe(true);
    expect(passOutcome('6.00', null)).toBeNull();
  });
});
