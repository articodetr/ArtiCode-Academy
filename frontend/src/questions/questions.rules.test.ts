// The mirror of backend/src/questions/questions.rules.ts, held to the cases of its spec
// (questions.rules.spec.ts — TEST-281): what the editor refuses before a request is what
// the server would refuse.
import { describe, expect, it } from 'vitest'
import { QUESTION_PROBLEMS } from '../api/questionBanks'
import { hasDuplicateOptions, normalizeTags, pointsText, questionProblems, sameOptions, sameTags } from './questions.rules'
import type { OptionContent, QuestionContent } from './questions.rules'

const option = (ar: string, isCorrect = false, en?: string): OptionContent => ({ text: en ? { ar, en } : { ar }, isCorrect })
const choice = (over: Partial<QuestionContent> = {}): QuestionContent => ({
  type: 'single_choice',
  status: 'ready',
  options: [option('4'), option('5', true), option('6'), option('23')],
  correctAnswer: null,
  ...over,
})
const trueFalse = (over: Partial<QuestionContent> = {}): QuestionContent => ({ type: 'true_false', status: 'ready', options: [], correctAnswer: true, ...over })

describe('questionProblems() — the mirror of the server rules', () => {
  it('accepts a ready single-choice question with 2..10 options and exactly one correct', () => {
    expect(questionProblems(choice())).toEqual([])
    expect(questionProblems(choice({ options: [option('صح', true), option('خطأ')] }))).toEqual([])
    expect(questionProblems(choice({ options: Array.from({ length: 10 }, (_, index) => option(`خيار ${index}`, index === 3)) }))).toEqual([])
  })

  it('names what a ready single-choice question lacks: options, a correct one', () => {
    expect(questionProblems(choice({ options: [] }))).toEqual(['options_too_few', 'correct_option_required'])
    expect(questionProblems(choice({ options: [option('5', true)] }))).toEqual(['options_too_few'])
    expect(questionProblems(choice({ options: [option('4'), option('5')] }))).toEqual(['correct_option_required'])
  })

  it('refuses in every status what is malformed: two correct options, a repeated text, more than ten, a boolean key', () => {
    for (const status of ['draft', 'ready', 'archived'] as const) {
      expect(questionProblems(choice({ status, options: [option('4', true), option('5', true)] }))).toEqual(['multiple_correct_options'])
      expect(questionProblems(choice({ status, options: [option('خمسة', true), option('  خمسة ')] }))).toEqual(['duplicate_options'])
      expect(questionProblems(choice({ status, options: Array.from({ length: 11 }, (_, index) => option(`خيار ${index}`, index === 0)) }))).toEqual(['options_too_many'])
      expect(questionProblems(choice({ status, correctAnswer: true }))).toEqual(['correct_answer_not_allowed'])
    }
  })

  it('lets a draft be incomplete, and an archived question keep what it had', () => {
    expect(questionProblems(choice({ status: 'draft', options: [] }))).toEqual([])
    expect(questionProblems(choice({ status: 'draft', options: [option('5')] }))).toEqual([])
    expect(questionProblems(choice({ status: 'archived', options: [option('5')] }))).toEqual([])
    expect(questionProblems(trueFalse({ status: 'draft', correctAnswer: null }))).toEqual([])
    expect(questionProblems(trueFalse({ status: 'archived', correctAnswer: null }))).toEqual([])
  })

  it('gives a true/false question its key and no options', () => {
    expect(questionProblems(trueFalse())).toEqual([])
    expect(questionProblems(trueFalse({ correctAnswer: false }))).toEqual([])
    expect(questionProblems(trueFalse({ correctAnswer: null }))).toEqual(['correct_answer_required'])
    expect(questionProblems(trueFalse({ options: [option('صح', true), option('خطأ')] }))).toEqual(['options_not_allowed'])
    expect(questionProblems(trueFalse({ status: 'draft', options: [option('صح')], correctAnswer: null }))).toEqual(['options_not_allowed'])
  })

  it('lists several problems in the catalogue order of the server, whatever the order they are found in', () => {
    const everything = questionProblems(
      choice({ correctAnswer: false, options: [...Array.from({ length: 10 }, (_, index) => option(`خيار ${index}`, index < 2)), option('خيار 0')] }),
    )
    expect(everything).toEqual(['correct_answer_not_allowed', 'options_too_many', 'multiple_correct_options', 'duplicate_options'])
    expect(everything).toEqual(QUESTION_PROBLEMS.filter((problem) => everything.includes(problem)))
    // Every problem of the catalogue is reachable through the mirror.
    const reached = new Set([
      ...everything,
      ...questionProblems(choice({ options: [] })),
      ...questionProblems(trueFalse({ correctAnswer: null, options: [option('صح')] })),
    ])
    expect([...reached].sort()).toEqual([...QUESTION_PROBLEMS].sort())
  })

  it('compares option texts by the Arabic text only, trimmed, single-spaced and case-insensitive', () => {
    expect(hasDuplicateOptions([option('Print  it'), option(' print it ')])).toBe(true)
    expect(hasDuplicateOptions([option('خمسة', false, 'Five'), option('ستة', false, 'Five')])).toBe(false)
    expect(hasDuplicateOptions([option('خمسة'), option('ستة'), option('خمسة')])).toBe(true)
    expect(hasDuplicateOptions([])).toBe(false)
  })
})

describe('normalizeTags()', () => {
  it('trims, single-spaces, lower-cases and drops blanks and repeats, keeping the first-seen order', () => {
    expect(normalizeTags(['  Loops ', 'python', 'LOOPS', '', '   ', 'data   types', 'حلقات'])).toEqual(['loops', 'python', 'data types', 'حلقات'])
    expect(normalizeTags([])).toEqual([])
  })
})

describe('pointsText()', () => {
  it('writes a JSON number as numeric(6,2) text', () => {
    expect(pointsText(1)).toBe('1.00')
    expect(pointsText(2.5)).toBe('2.50')
    expect(pointsText(0.01)).toBe('0.01')
    expect(pointsText(9999.99)).toBe('9999.99')
  })
})

describe('sameOptions() and sameTags()', () => {
  const stored = [option('4'), option('5', true)]

  it('sees the options as one ordered list: a new order, a new key, a new text or a new locale is a change', () => {
    expect(sameOptions(stored, [option('4'), option('5', true)])).toBe(true)
    expect(sameOptions(stored, [option('5', true), option('4')])).toBe(false)
    expect(sameOptions(stored, [option('4', true), option('5')])).toBe(false)
    expect(sameOptions(stored, [option('4'), option('5', true), option('6')])).toBe(false)
    expect(sameOptions(stored, [option('4'), option('5', true, 'Five')])).toBe(false)
    expect(sameOptions([], [])).toBe(true)
  })

  it('reads an option the server sent (with its id) like any other', () => {
    const fromServer = [
      { id: 'a', text: { ar: '4' }, isCorrect: false },
      { id: 'b', text: { ar: '5' }, isCorrect: true },
    ]
    expect(sameOptions(stored, fromServer)).toBe(true)
  })

  it('compares tags in order', () => {
    expect(sameTags(['math', 'sum'], ['math', 'sum'])).toBe(true)
    expect(sameTags(['math', 'sum'], ['sum', 'math'])).toBe(false)
    expect(sameTags(['math'], ['math', 'sum'])).toBe(false)
    expect(sameTags([], [])).toBe(true)
  })
})
