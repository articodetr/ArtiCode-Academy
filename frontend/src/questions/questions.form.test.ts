import { describe, expect, it } from 'vitest'
import { QUESTION_PROBLEMS } from '../api/questionBanks'
import type { QuestionProblem } from '../api/questionBanks'
import { makeDraftQuestion, makeQuestion, makeTrueFalseQuestion } from '../test/questionBanks'
import {
  buildCreateQuestionInput,
  emptyOption,
  formProblems,
  isBlankOption,
  markCorrectOption,
  newQuestionForm,
  newQuestionHasWork,
  optionRowIssue,
  optionsOf,
  problemPlaceOf,
  problemsAt,
  questionContentOf,
  questionFormValuesOf,
} from './questions.form'
import type { OptionFormValues, QuestionFormValues } from './questions.form'

const row = (textAr: string, isCorrect = false, textEn = ''): OptionFormValues => ({ textAr, textEn, isCorrect })
const form = (over: Partial<QuestionFormValues> = {}): QuestionFormValues => ({ ...newQuestionForm(), promptAr: 'ما ناتج 2 + 3؟', ...over })

describe('newQuestionForm() and questionFormValuesOf()', () => {
  it('starts a new question as single choice with one point, no difficulty, no tag and four empty rows', () => {
    const values = newQuestionForm()
    expect(values).toEqual({
      type: 'single_choice',
      promptAr: '',
      promptEn: '',
      explanationAr: '',
      explanationEn: '',
      points: 1,
      difficulty: 'none',
      tags: [],
      options: [emptyOption(), emptyOption(), emptyOption(), emptyOption()],
      correctAnswer: null,
    })
    // Each row is its own object: editing one never touches another.
    expect(values.options[0]).not.toBe(values.options[1])
  })

  it('reads a single-choice question into the form: texts, key, and the Turkish text of an option kept with its row', () => {
    expect(questionFormValuesOf(makeQuestion())).toEqual({
      type: 'single_choice',
      promptAr: 'ما ناتج print(2 + 3) في بايثون؟',
      promptEn: 'What does print(2 + 3) output in Python?',
      explanationAr: 'عامل الجمع يجمع العددين.',
      explanationEn: '',
      points: 2,
      difficulty: 'easy',
      tags: ['python', 'حساب'],
      options: [
        { textAr: '4', textEn: '', isCorrect: false },
        { textAr: '5', textEn: '', isCorrect: true },
        { textAr: '6', textEn: '', textTr: 'altı', isCorrect: false },
        { textAr: '23', textEn: '', isCorrect: false },
      ],
      correctAnswer: null,
    })
  })

  it('always shows at least two rows of a single-choice question, and none of a true/false one', () => {
    expect(questionFormValuesOf(makeDraftQuestion()).options).toEqual([{ textAr: 'for', textEn: '', isCorrect: false }, emptyOption()])
    expect(questionFormValuesOf(makeDraftQuestion({ options: [] })).options).toEqual([emptyOption(), emptyOption()])
    const trueFalse = questionFormValuesOf(makeTrueFalseQuestion())
    expect(trueFalse.options).toEqual([])
    expect(trueFalse.correctAnswer).toBe(true)
    expect(trueFalse.difficulty).toBe('none')
    expect(questionFormValuesOf(makeTrueFalseQuestion({ correctAnswer: false })).correctAnswer).toBe(false)
    expect(questionFormValuesOf(makeTrueFalseQuestion({ status: 'draft', correctAnswer: null })).correctAnswer).toBeNull()
  })
})

describe('the rows of the options editor', () => {
  it('tells a row nobody wrote in from a written one', () => {
    expect(isBlankOption(emptyOption())).toBe(true)
    expect(isBlankOption({ textAr: '   ', textEn: ' ' })).toBe(true)
    expect(isBlankOption(undefined)).toBe(true)
    expect(isBlankOption(row('5'))).toBe(false)
    expect(isBlankOption(row('', false, 'Five'))).toBe(false)
    // The «correct» mark is something a close would lose.
    expect(isBlankOption(row('', true))).toBe(false)
  })

  it('names why a row cannot be sent: English without Arabic, or the key on a row without a text', () => {
    expect(optionRowIssue(row('5', true, 'Five'))).toBeNull()
    expect(optionRowIssue(emptyOption())).toBeNull()
    expect(optionRowIssue(undefined)).toBeNull()
    expect(optionRowIssue(row('  ', false, 'Five'))).toBe('optionArabicFirst')
    expect(optionRowIssue(row('', true, 'Five'))).toBe('optionArabicFirst')
    expect(optionRowIssue(row('', true))).toBe('correctOptionBlank')
  })

  it('marks one row as the key and clears every other mark', () => {
    const rows = [row('4', true), row('5'), row('6', true)]
    expect(markCorrectOption(rows, 1)).toEqual([row('4'), row('5', true), row('6')])
    // The rows given are left as they were.
    expect(rows[0]!.isCorrect).toBe(true)
  })

  it('reads the options the rows spell, in order: every row with an Arabic text, trimmed, with its English and Turkish texts', () => {
    expect(optionsOf([row(' 4 '), emptyOption(), row('5', true, ' Five '), { textAr: '6', textEn: '', textTr: 'altı', isCorrect: false }, row('', false, 'Seven')])).toEqual([
      { text: { ar: '4' }, isCorrect: false },
      { text: { ar: '5', en: 'Five' }, isCorrect: true },
      { text: { ar: '6', tr: 'altı' }, isCorrect: false },
    ])
    expect(optionsOf(undefined)).toEqual([])
    expect(optionsOf([undefined])).toEqual([])
  })
})

describe('questionContentOf() and formProblems() — the server rules on the form', () => {
  it('gives the rules the options of a single-choice question and the key of a true/false one, never both', () => {
    expect(questionContentOf(form({ options: [row('4'), row('5', true)], correctAnswer: true }), 'ready')).toEqual({
      type: 'single_choice',
      status: 'ready',
      options: [
        { text: { ar: '4' }, isCorrect: false },
        { text: { ar: '5' }, isCorrect: true },
      ],
      correctAnswer: null,
    })
    expect(questionContentOf(form({ type: 'true_false', options: [row('4')], correctAnswer: false }), 'draft')).toEqual({ type: 'true_false', status: 'draft', options: [], correctAnswer: false })
  })

  it('accepts a draft with only a prompt, and names what the same form lacks to be ready', () => {
    const untouched = form()
    expect(formProblems(untouched, 'draft')).toEqual([])
    expect(formProblems(untouched, 'ready')).toEqual(['options_too_few', 'correct_option_required'])
    expect(formProblems(form({ options: [row('4'), row('5'), emptyOption()] }), 'ready')).toEqual(['correct_option_required'])
    expect(formProblems(form({ options: [row('5', true), emptyOption()] }), 'ready')).toEqual(['options_too_few'])
    expect(formProblems(form({ options: [row('4'), row('5', true), emptyOption(), emptyOption()] }), 'ready')).toEqual([])
  })

  it('refuses a repeated Arabic text in a draft too, and ignores the rows nobody wrote in', () => {
    const repeated = form({ options: [row('خمسة'), emptyOption(), row(' خمسة ', true)] })
    expect(formProblems(repeated, 'draft')).toEqual(['duplicate_options'])
    expect(formProblems(repeated, 'ready')).toEqual(['duplicate_options'])
    expect(formProblems(repeated, 'archived')).toEqual(['duplicate_options'])
  })

  it('asks a ready true/false question for its key, and a draft for nothing', () => {
    const trueFalse = form({ type: 'true_false', correctAnswer: null })
    expect(formProblems(trueFalse, 'draft')).toEqual([])
    expect(formProblems(trueFalse, 'ready')).toEqual(['correct_answer_required'])
    expect(formProblems({ ...trueFalse, correctAnswer: false }, 'ready')).toEqual([])
  })
})

describe('problemPlaceOf() and problemsAt() — where the editor shows a problem', () => {
  it('puts the problems of the options under the options of a single-choice question', () => {
    const options: QuestionProblem[] = ['options_too_many', 'multiple_correct_options', 'duplicate_options', 'options_too_few', 'correct_option_required']
    for (const problem of options) expect(problemPlaceOf('single_choice', problem)).toBe('options')
    // Nothing of this form fixes a boolean key on a single-choice question.
    expect(problemPlaceOf('single_choice', 'correct_answer_not_allowed')).toBe('form')
    expect(problemPlaceOf('single_choice', 'correct_answer_required')).toBe('form')
  })

  it('puts the missing key on the true/false field, and everything else above the form', () => {
    expect(problemPlaceOf('true_false', 'correct_answer_required')).toBe('answer')
    for (const problem of QUESTION_PROBLEMS.filter((candidate) => candidate !== 'correct_answer_required')) expect(problemPlaceOf('true_false', problem)).toBe('form')
  })

  it('keeps the order given when it picks the problems of one place', () => {
    const problems: QuestionProblem[] = ['correct_answer_not_allowed', 'duplicate_options', 'options_too_few', 'correct_option_required']
    expect(problemsAt('single_choice', problems, 'options')).toEqual(['duplicate_options', 'options_too_few', 'correct_option_required'])
    expect(problemsAt('single_choice', problems, 'form')).toEqual(['correct_answer_not_allowed'])
    expect(problemsAt('single_choice', problems, 'answer')).toEqual([])
  })
})

describe('buildCreateQuestionInput() — the body of API-266', () => {
  it('sends a ready single-choice question whole: the options in order with JSON booleans, the points as a JSON number, the status', () => {
    const input = buildCreateQuestionInput(
      form({
        promptAr: ' ما ناتج 2 + 3؟ ',
        promptEn: ' What is 2 + 3? ',
        explanationAr: 'الجمع',
        points: 2.5,
        difficulty: 'medium',
        tags: ['math', 'sum'],
        options: [row('4'), row('5', true, 'Five'), emptyOption(), row('6')],
      }),
      'ready',
    )
    expect(input).toEqual({
      type: 'single_choice',
      prompt: { ar: 'ما ناتج 2 + 3؟', en: 'What is 2 + 3?' },
      explanation: { ar: 'الجمع' },
      points: 2.5,
      difficulty: 'medium',
      tags: ['math', 'sum'],
      status: 'ready',
      options: [
        { text: { ar: '4' }, isCorrect: false },
        { text: { ar: '5', en: 'Five' }, isCorrect: true },
        { text: { ar: '6' }, isCorrect: false },
      ],
    })
    expect(typeof input.points).toBe('number')
    expect(input.options?.map((option) => typeof option.isCorrect)).toEqual(['boolean', 'boolean', 'boolean'])
    expect('correctAnswer' in input).toBe(false)
  })

  it('sends a draft with only a prompt as the type, the prompt, the points and the status — nothing else', () => {
    expect(buildCreateQuestionInput(form(), 'draft')).toEqual({ type: 'single_choice', prompt: { ar: 'ما ناتج 2 + 3؟' }, points: 1, status: 'draft' })
  })

  it('sends the key of a true/false question as a JSON boolean — false included — and never its options', () => {
    const base = form({ type: 'true_false', promptAr: 'بايثون لغة مفسَّرة.', options: [row('4', true)] })
    expect(buildCreateQuestionInput({ ...base, correctAnswer: false }, 'ready')).toEqual({ type: 'true_false', prompt: { ar: 'بايثون لغة مفسَّرة.' }, points: 1, status: 'ready', correctAnswer: false })
    expect(buildCreateQuestionInput({ ...base, correctAnswer: true }, 'ready').correctAnswer).toBe(true)
    // A draft without a key yet sends none.
    expect(buildCreateQuestionInput(base, 'draft')).toEqual({ type: 'true_false', prompt: { ar: 'بايثون لغة مفسَّرة.' }, points: 1, status: 'draft' })
  })

  it('sends the tags as the server stores them, and no explanation written in English alone', () => {
    const input = buildCreateQuestionInput(form({ tags: [' Loops ', 'loops', 'Data  Types'], explanationEn: 'Only English' }), 'draft')
    expect(input.tags).toEqual(['loops', 'data types'])
    expect('explanation' in input).toBe(false)
    expect('difficulty' in input).toBe(false)
  })
})

describe('newQuestionHasWork() — the unsaved guard of a new question', () => {
  it('holds nothing at its start, whatever the type and the number of empty rows', () => {
    expect(newQuestionHasWork(newQuestionForm())).toBe(false)
    expect(newQuestionHasWork({ ...newQuestionForm(), type: 'true_false' })).toBe(false)
    expect(newQuestionHasWork({ ...newQuestionForm(), options: [emptyOption()] })).toBe(false)
    expect(newQuestionHasWork({ ...newQuestionForm(), promptAr: '   ', options: [...newQuestionForm().options, emptyOption()] })).toBe(false)
  })

  it('holds anything written or chosen', () => {
    const start = newQuestionForm()
    expect(newQuestionHasWork({ ...start, promptAr: 'س' })).toBe(true)
    expect(newQuestionHasWork({ ...start, promptEn: 'Q' })).toBe(true)
    expect(newQuestionHasWork({ ...start, explanationAr: 'شرح' })).toBe(true)
    expect(newQuestionHasWork({ ...start, points: 2 })).toBe(true)
    expect(newQuestionHasWork({ ...start, points: null })).toBe(true)
    expect(newQuestionHasWork({ ...start, difficulty: 'hard' })).toBe(true)
    expect(newQuestionHasWork({ ...start, tags: ['loops'] })).toBe(true)
    expect(newQuestionHasWork({ ...start, options: [row('4'), emptyOption()] })).toBe(true)
    expect(newQuestionHasWork({ ...start, options: [row('', true), emptyOption()] })).toBe(true)
    expect(newQuestionHasWork({ ...start, type: 'true_false', correctAnswer: false })).toBe(true)
  })
})
