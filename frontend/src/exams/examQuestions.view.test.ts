import { describe, expect, it } from 'vitest'
import { CORRECTION_REASON_MAX_LENGTH } from '../api/examQuestions'
import { EXAM_QUESTION_IDS, POWER_OPTION_IDS, frozenItems, makeExamQuestionItem, makeKeyCorrectionResult, threeExamQuestions } from '../test/examQuestions'
import { FALSE_CHOICE, TRUE_CHOICE, answerChoicesOf, buildCorrectKeyInput, isCorrectionReasonValid, keyChoiceOf, previewQuestionsOf } from './examQuestions.view'

const [power, lists] = threeExamQuestions()

describe('examQuestions.view — the answers of a question with their key (the teacher’s side)', () => {
  it('lists a single-choice question’s own options in order and marks the correct one', () => {
    expect(answerChoicesOf(power!.question)).toEqual([
      { value: POWER_OPTION_IDS[0], text: { ar: '6' }, answer: null, isKey: false },
      { value: POWER_OPTION_IDS[1], text: { ar: '8' }, answer: null, isKey: true },
      { value: POWER_OPTION_IDS[2], text: { ar: '9' }, answer: null, isKey: false },
    ])
    expect(keyChoiceOf(power!.question)).toBe(POWER_OPTION_IDS[1])
  })

  it('gives a true/false question its two answers and marks the key', () => {
    expect(answerChoicesOf(lists!.question)).toEqual([
      { value: TRUE_CHOICE, text: null, answer: true, isKey: true },
      { value: FALSE_CHOICE, text: null, answer: false, isKey: false },
    ])
    expect(keyChoiceOf(lists!.question)).toBe(TRUE_CHOICE)
    expect(keyChoiceOf({ ...lists!.question, correctAnswer: false })).toBe(FALSE_CHOICE)
  })

  it('finds no key for a question without one (a draft’s incomplete question)', () => {
    expect(keyChoiceOf({ ...lists!.question, correctAnswer: null })).toBeUndefined()
    expect(keyChoiceOf({ ...power!.question, options: power!.question.options.map((option) => ({ ...option, isCorrect: false })) })).toBeUndefined()
  })

  it('follows a corrected key: the answer of API-272 marks the new option', () => {
    expect(keyChoiceOf(makeKeyCorrectionResult().question.question)).toBe(POWER_OPTION_IDS[2])
  })
})

describe('examQuestions.view — the preview a learner would see', () => {
  const preview = previewQuestionsOf(frozenItems())

  it('keeps the order, the points, the prompt and the choices of every question', () => {
    expect(preview.map((question) => question.id)).toEqual([...EXAM_QUESTION_IDS])
    expect(preview.map((question) => question.points)).toEqual([4, 3, 3])
    expect(preview[0]).toEqual({
      id: EXAM_QUESTION_IDS[0],
      points: 4,
      type: 'single_choice',
      prompt: power!.question.prompt,
      choices: [
        { value: POWER_OPTION_IDS[0], text: { ar: '6' }, answer: null },
        { value: POWER_OPTION_IDS[1], text: { ar: '8' }, answer: null },
        { value: POWER_OPTION_IDS[2], text: { ar: '9' }, answer: null },
      ],
    })
    expect(preview[1]!.choices).toEqual([
      { value: TRUE_CHOICE, text: null, answer: true },
      { value: FALSE_CHOICE, text: null, answer: false },
    ])
  })

  it('carries no key, no explanation and no correction — by name, anywhere in the projection', () => {
    const corrected = previewQuestionsOf([makeKeyCorrectionResult().question, makeExamQuestionItem()])
    const serialized = JSON.stringify([preview, corrected])
    for (const secret of ['isCorrect', 'isKey', 'correctAnswer', 'correctOptionId', 'explanation', 'corrections', 'reason', 'byUserId']) expect(serialized).not.toContain(secret)
    // Nor the explanation's or a correction's own words.
    expect(serialized).not.toContain(power!.question.explanation!.ar)
    expect(serialized).not.toContain(makeKeyCorrectionResult().question.corrections[0]!.reason)
  })
})

describe('examQuestions.view — the body of a key correction (API-272)', () => {
  it('needs a reason of 1–500 characters after trimming', () => {
    expect(isCorrectionReasonValid('سبب')).toBe(true)
    expect(isCorrectionReasonValid('x'.repeat(CORRECTION_REASON_MAX_LENGTH))).toBe(true)
    expect(isCorrectionReasonValid(`  ${'x'.repeat(CORRECTION_REASON_MAX_LENGTH)}  `)).toBe(true)
    expect(isCorrectionReasonValid('x'.repeat(CORRECTION_REASON_MAX_LENGTH + 1))).toBe(false)
    expect(isCorrectionReasonValid('   ')).toBe(false)
    expect(isCorrectionReasonValid('')).toBe(false)
    expect(isCorrectionReasonValid(undefined)).toBe(false)
  })

  it('names one of the question’s own options for a single-choice question — never a boolean', () => {
    const body = buildCorrectKeyInput('single_choice', POWER_OPTION_IDS[2], '  المفتاح كان خطأ  ')
    expect(body).toEqual({ correctOptionId: POWER_OPTION_IDS[2], reason: 'المفتاح كان خطأ' })
    expect(body).not.toHaveProperty('correctAnswer')
  })

  it('names a JSON boolean for a true/false question — never an option', () => {
    const toFalse = buildCorrectKeyInput('true_false', FALSE_CHOICE, 'خطأ في المفتاح')
    expect(toFalse).toEqual({ correctAnswer: false, reason: 'خطأ في المفتاح' })
    expect(typeof toFalse!.correctAnswer).toBe('boolean')
    expect(toFalse).not.toHaveProperty('correctOptionId')
    expect(buildCorrectKeyInput('true_false', TRUE_CHOICE, 'سبب')).toEqual({ correctAnswer: true, reason: 'سبب' })
  })

  it('builds nothing without an answer, without a reason, or for an answer that is not true/false', () => {
    expect(buildCorrectKeyInput('single_choice', undefined, 'سبب')).toBeNull()
    expect(buildCorrectKeyInput('single_choice', POWER_OPTION_IDS[0], '   ')).toBeNull()
    expect(buildCorrectKeyInput('single_choice', POWER_OPTION_IDS[0], undefined)).toBeNull()
    expect(buildCorrectKeyInput('true_false', POWER_OPTION_IDS[0], 'سبب')).toBeNull()
    expect(buildCorrectKeyInput('true_false', undefined, 'سبب')).toBeNull()
  })
})
