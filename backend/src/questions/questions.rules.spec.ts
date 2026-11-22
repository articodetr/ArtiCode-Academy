// TEST-281 (unit part) — the pure rules of the question banks (D-R163/D-R164).
import { describe, expect, it } from 'vitest';
import { hasDuplicateOptions, normalizeTags, planBankUpdate, planQuestionUpdate, pointsText, questionProblems, sameOptions } from './questions.rules.js';
import type { OptionContent, QuestionContent, QuestionValues } from './questions.rules.js';

const option = (ar: string, isCorrect = false, en?: string): OptionContent => ({ text: en ? { ar, en } : { ar }, isCorrect });
const choice = (over: Partial<QuestionContent> = {}): QuestionContent => ({
  type: 'single_choice',
  status: 'ready',
  options: [option('4'), option('5', true), option('6'), option('23')],
  correctAnswer: null,
  ...over,
});
const trueFalse = (over: Partial<QuestionContent> = {}): QuestionContent => ({ type: 'true_false', status: 'ready', options: [], correctAnswer: true, ...over });

describe('questionProblems()', () => {
  it('accepts a ready single-choice question with 2..10 options and exactly one correct', () => {
    expect(questionProblems(choice())).toEqual([]);
    expect(questionProblems(choice({ options: [option('صح', true), option('خطأ')] }))).toEqual([]);
    expect(questionProblems(choice({ options: Array.from({ length: 10 }, (_, index) => option(`خيار ${index}`, index === 3)) }))).toEqual([]);
  });

  it('names what a ready single-choice question lacks: options, a correct one', () => {
    expect(questionProblems(choice({ options: [] }))).toEqual(['options_too_few', 'correct_option_required']);
    expect(questionProblems(choice({ options: [option('5', true)] }))).toEqual(['options_too_few']);
    expect(questionProblems(choice({ options: [option('4'), option('5')] }))).toEqual(['correct_option_required']);
  });

  it('refuses in every status what is malformed: two correct options, a repeated text, more than ten, a boolean key', () => {
    for (const status of ['draft', 'ready', 'archived'] as const) {
      expect(questionProblems(choice({ status, options: [option('4', true), option('5', true)] }))).toEqual(['multiple_correct_options']);
      expect(questionProblems(choice({ status, options: [option('خمسة', true), option('  خمسة ')] }))).toEqual(['duplicate_options']);
      expect(questionProblems(choice({ status, options: Array.from({ length: 11 }, (_, index) => option(`خيار ${index}`, index === 0)) }))).toEqual(['options_too_many']);
      expect(questionProblems(choice({ status, correctAnswer: true }))).toEqual(['correct_answer_not_allowed']);
    }
  });

  it('lets a draft be incomplete, and an archived question keep what it had', () => {
    expect(questionProblems(choice({ status: 'draft', options: [] }))).toEqual([]);
    expect(questionProblems(choice({ status: 'draft', options: [option('5')] }))).toEqual([]);
    expect(questionProblems(choice({ status: 'archived', options: [option('5')] }))).toEqual([]);
    expect(questionProblems(trueFalse({ status: 'draft', correctAnswer: null }))).toEqual([]);
    expect(questionProblems(trueFalse({ status: 'archived', correctAnswer: null }))).toEqual([]);
  });

  it('gives a true/false question its key and no options', () => {
    expect(questionProblems(trueFalse())).toEqual([]);
    expect(questionProblems(trueFalse({ correctAnswer: false }))).toEqual([]);
    expect(questionProblems(trueFalse({ correctAnswer: null }))).toEqual(['correct_answer_required']);
    expect(questionProblems(trueFalse({ options: [option('صح', true), option('خطأ')] }))).toEqual(['options_not_allowed']);
    expect(questionProblems(trueFalse({ status: 'draft', options: [option('صح')], correctAnswer: null }))).toEqual(['options_not_allowed']);
  });

  it('compares option texts by the Arabic text only, trimmed, single-spaced and case-insensitive', () => {
    expect(hasDuplicateOptions([option('Print  it'), option(' print it ')])).toBe(true);
    expect(hasDuplicateOptions([option('خمسة', false, 'Five'), option('ستة', false, 'Five')])).toBe(false);
    expect(hasDuplicateOptions([])).toBe(false);
  });
});

describe('normalizeTags()', () => {
  it('trims, single-spaces, lower-cases and drops blanks and repeats, keeping the first-seen order', () => {
    expect(normalizeTags(['  Loops ', 'python', 'LOOPS', '', '   ', 'data   types', 'حلقات'])).toEqual(['loops', 'python', 'data types', 'حلقات']);
    expect(normalizeTags([])).toEqual([]);
  });
});

describe('pointsText()', () => {
  it('writes a JSON number as numeric(6,2) text', () => {
    expect(pointsText(1)).toBe('1.00');
    expect(pointsText(2.5)).toBe('2.50');
    expect(pointsText(0.01)).toBe('0.01');
    expect(pointsText(9999.99)).toBe('9999.99');
  });
});

describe('planQuestionUpdate()', () => {
  const current: QuestionValues = {
    status: 'draft',
    prompt: { ar: 'ما ناتج 2 + 3؟', en: 'What is 2 + 3?' },
    explanation: { ar: 'الجمع' },
    points: '2.00',
    difficulty: 'easy',
    tags: ['math'],
    options: [option('4'), option('5', true)],
    correctAnswer: null,
  };

  it('plans nothing for the same values, however they are spelled', () => {
    const plan = planQuestionUpdate(current, {
      status: 'draft',
      prompt: { ar: 'ما ناتج 2 + 3؟', en: 'What is 2 + 3?' },
      explanation: { ar: 'الجمع' },
      points: '2.00',
      difficulty: 'easy',
      tags: ['math'],
      options: [option('4'), option('5', true)],
      correctAnswer: null,
    });
    expect(plan.fields).toEqual([]);
    expect(plan.data).toEqual({});
    expect(plan.next).toEqual(current);
  });

  it('keeps only the fields that differ, in catalogue order, and gives the merged question', () => {
    const plan = planQuestionUpdate(current, { points: '3.00', status: 'ready', prompt: { ar: 'ما ناتج 2 + 3؟', en: 'What is 2 + 3?' }, tags: ['math', 'sum'] });
    expect(plan.fields).toEqual(['status', 'points', 'tags']);
    expect(plan.data).toEqual({ status: 'ready', points: '3.00', tags: ['math', 'sum'] });
    expect(plan.next).toEqual({ ...current, status: 'ready', points: '3.00', tags: ['math', 'sum'] });
  });

  it('clears with null and treats a dropped locale as a change', () => {
    const plan = planQuestionUpdate(current, { explanation: null, difficulty: null, prompt: { ar: 'ما ناتج 2 + 3؟' } });
    expect(plan.fields).toEqual(['prompt', 'explanation', 'difficulty']);
    expect(plan.next.explanation).toBeNull();
    expect(plan.next.difficulty).toBeNull();
    expect(plan.next.prompt).toEqual({ ar: 'ما ناتج 2 + 3؟' });
  });

  it('sees the options as one ordered list: a new order, a new key or a new text is a change', () => {
    expect(planQuestionUpdate(current, { options: [option('5', true), option('4')] }).fields).toEqual(['options']);
    expect(planQuestionUpdate(current, { options: [option('4', true), option('5')] }).fields).toEqual(['options']);
    expect(planQuestionUpdate(current, { options: [option('4'), option('5', true), option('6')] }).fields).toEqual(['options']);
    expect(planQuestionUpdate(current, { options: [option('4'), option('5', true, 'Five')] }).fields).toEqual(['options']);
    expect(sameOptions(current.options, [option('4'), option('5', true)])).toBe(true);
  });

  it('plans the key of a true/false question, false included', () => {
    const trueFalseValues: QuestionValues = { ...current, options: [], correctAnswer: true };
    expect(planQuestionUpdate(trueFalseValues, { correctAnswer: false }).data).toEqual({ correctAnswer: false });
    expect(planQuestionUpdate(trueFalseValues, { correctAnswer: null }).fields).toEqual(['correctAnswer']);
    expect(planQuestionUpdate(trueFalseValues, { correctAnswer: true }).fields).toEqual([]);
  });
});

describe('planBankUpdate()', () => {
  const current = { name: { ar: 'بنك بايثون' }, description: null, courseId: 'c1' };

  it('plans nothing for the same values', () => {
    expect(planBankUpdate(current, { name: { ar: 'بنك بايثون' }, description: null, courseId: 'c1' })).toEqual({ data: {}, fields: [] });
  });

  it('keeps the fields that differ and clears the course and the description with null', () => {
    expect(planBankUpdate(current, { name: { ar: 'بنك بايثون', en: 'Python bank' }, courseId: null })).toEqual({
      data: { name: { ar: 'بنك بايثون', en: 'Python bank' }, courseId: null },
      fields: ['name', 'courseId'],
    });
    expect(planBankUpdate({ ...current, description: { ar: 'وصف' } }, { description: null }).fields).toEqual(['description']);
  });
});
