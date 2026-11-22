// MOD-09 phase 2 (OEX-T07) — the learner's answers on the exam page: their
// shape, what a save sends, what the navigator and the review count, and the
// choices of a question. Nothing here knows which answer is right.
import { describe, expect, it } from 'vitest'
import { OPTION_IDS, QUESTION_IDS, makeAnsweredQuestions, makeAttemptQuestions, makeReviewedQuestions } from '../test/myAttempts'
import {
  answeredCount,
  answersOf,
  booleanAnswer,
  choiceAnswer,
  entryOf,
  isAnswered,
  openingIndex,
  questionMark,
  radioValueOf,
  reconcileAnswers,
  sameAnswer,
  unansweredNumbers,
  unsavedNumbers,
} from './takeExam.answers'
import type { LocalAnswer } from './takeExam.answers'
import { choicesOf, correctValueOf, isFinishedAttempt, takeExamPath } from './takeExam.format'

const [Q1, Q2, Q3] = QUESTION_IDS
const WORDS = { trueOption: 'صحيح', falseOption: 'خطأ' }

describe('an answer', () => {
  it('is the whole answer of its question: an option, a boolean, or nothing', () => {
    expect(choiceAnswer('o-1')).toEqual({ optionId: 'o-1', value: null })
    expect(booleanAnswer(false)).toEqual({ optionId: null, value: false })
    expect(isAnswered(choiceAnswer('o-1'))).toBe(true)
    expect(isAnswered(booleanAnswer(false))).toBe(true) // «خطأ» is an answer
    expect(isAnswered(null)).toBe(false)
    expect(isAnswered(undefined)).toBe(false)
    expect(isAnswered({ optionId: null, value: null })).toBe(false)
  })

  it('is saved as the server takes it: `optionId`, a JSON boolean `value`, or neither field to clear', () => {
    expect(entryOf(Q1, choiceAnswer('o-1'))).toEqual({ examQuestionId: Q1, optionId: 'o-1' })
    expect(entryOf(Q3, booleanAnswer(true))).toEqual({ examQuestionId: Q3, value: true })
    expect(entryOf(Q3, booleanAnswer(false))).toEqual({ examQuestionId: Q3, value: false })
    expect(typeof entryOf(Q3, booleanAnswer(false)).value).toBe('boolean')
    expect(entryOf(Q2, null)).toEqual({ examQuestionId: Q2 })
    expect(entryOf(Q2, { optionId: null, value: null })).toEqual({ examQuestionId: Q2 })
  })

  it('compares by what would be saved', () => {
    expect(sameAnswer(choiceAnswer('o-1'), { optionId: 'o-1', value: null })).toBe(true)
    expect(sameAnswer(choiceAnswer('o-1'), choiceAnswer('o-2'))).toBe(false)
    expect(sameAnswer(booleanAnswer(true), booleanAnswer(false))).toBe(false)
    expect(sameAnswer(null, undefined)).toBe(true)
    expect(sameAnswer(null, { optionId: null, value: null })).toBe(true)
    expect(sameAnswer(null, booleanAnswer(false))).toBe(false)
  })

  it('gives its radio group a value: the option, `true` / `false`, or none', () => {
    expect(radioValueOf(choiceAnswer('o-1'))).toBe('o-1')
    expect(radioValueOf(booleanAnswer(true))).toBe('true')
    expect(radioValueOf(booleanAnswer(false))).toBe('false')
    expect(radioValueOf(null)).toBe('')
    expect(radioValueOf(undefined)).toBe('')
  })
})

describe('the answers of an attempt', () => {
  it('start from what the server holds', () => {
    expect([...answersOf(makeAttemptQuestions())]).toEqual([
      [Q1, null],
      [Q2, null],
      [Q3, null],
    ])
    const answers = answersOf(makeAnsweredQuestions())
    expect(answers.get(Q1)).toEqual(choiceAnswer(OPTION_IDS.first[1]))
    expect(answers.get(Q2)).toBeNull()
    expect(answers.get(Q3)).toEqual(booleanAnswer(true))
  })

  it('count the answered, name the unanswered by position and mark each question for the navigator', () => {
    const questions = makeAnsweredQuestions()
    const answers = answersOf(questions)
    expect(answeredCount(questions, answers)).toBe(2)
    expect(unansweredNumbers(questions, answers)).toEqual([2])
    expect(questions.map((question) => questionMark(answers.get(question.id)))).toEqual(['answered', 'unanswered', 'answered'])
    expect(unansweredNumbers(questions, new Map())).toEqual([1, 2, 3])
    expect(answeredCount([], new Map())).toBe(0)
  })

  it('open on the first question without an answer — the first one when all are answered', () => {
    const questions = makeAnsweredQuestions()
    expect(openingIndex(questions, answersOf(questions))).toBe(1)
    expect(openingIndex(questions, new Map())).toBe(0)
    const all = new Map<string, LocalAnswer>([...answersOf(questions), [Q2, choiceAnswer(OPTION_IDS.second[0])]])
    expect(openingIndex(questions, all)).toBe(0)
    expect(openingIndex([], new Map())).toBe(0)
  })

  it('after a re-read keep the changes the server has not got yet, and take its word for everything else', () => {
    const server = makeAnsweredQuestions() // «ثمانية», none, «صحيح»
    const unsaved = new Map<string, LocalAnswer>([
      [Q2, choiceAnswer(OPTION_IDS.second[2])], // chosen here, not saved yet
      [Q3, null], // cleared here, not saved yet
      ['not-a-question', choiceAnswer('x')],
    ])
    const answers = reconcileAnswers(server, unsaved)
    expect(answers.get(Q1)).toEqual(choiceAnswer(OPTION_IDS.first[1])) // the server's (another tab may have set it)
    expect(answers.get(Q2)).toEqual(choiceAnswer(OPTION_IDS.second[2]))
    expect(answers.get(Q3)).toBeNull()
    expect(answers.has('not-a-question')).toBe(false)
  })

  it('name the answers that never reached the server once the attempt has closed — and only those', () => {
    const server = makeAnsweredQuestions()
    const unsaved = new Map<string, LocalAnswer>([
      [Q1, choiceAnswer(OPTION_IDS.first[1])], // the same as the server holds: nothing was lost
      [Q2, choiceAnswer(OPTION_IDS.second[0])], // never arrived
      [Q3, booleanAnswer(false)], // the server holds «صحيح»
    ])
    expect(unsavedNumbers(server, unsaved)).toEqual([2, 3])
    expect(unsavedNumbers(server, new Map())).toEqual([])
  })
})

describe('the choices of a question', () => {
  it('are its options in display order, or «صحيح» / «خطأ»', () => {
    const [choice, , trueFalse] = makeAttemptQuestions()
    expect(choicesOf(choice!, WORDS, 'ar')).toEqual([
      { value: OPTION_IDS.first[0], label: 'ستة', answer: choiceAnswer(OPTION_IDS.first[0]) },
      { value: OPTION_IDS.first[1], label: 'ثمانية', answer: choiceAnswer(OPTION_IDS.first[1]) },
      { value: OPTION_IDS.first[2], label: 'تسعة', answer: choiceAnswer(OPTION_IDS.first[2]) },
    ])
    expect(choicesOf(trueFalse!, WORDS, 'ar')).toEqual([
      { value: 'true', label: 'صحيح', answer: booleanAnswer(true) },
      { value: 'false', label: 'خطأ', answer: booleanAnswer(false) },
    ])
    // The active language, with the mandatory Arabic as the fallback.
    expect(choicesOf({ type: 'single_choice', options: [{ id: 'o', text: { ar: 'نص', en: 'Text' } }] }, WORDS, 'en')[0]!.label).toBe('Text')
    expect(choicesOf({ type: 'single_choice', options: [{ id: 'o', text: { ar: 'نص' } }] }, WORDS, 'en')[0]!.label).toBe('نص')
  })

  it('carry no correct mark of their own: the correct one is named by the server’s review, or by nobody', () => {
    // In progress, and finished before the review is released: `review` is null — nothing is correct.
    for (const question of [...makeAttemptQuestions(), ...makeAnsweredQuestions()]) expect(correctValueOf(question)).toBeNull()
    // Released: the server's own words.
    expect(makeReviewedQuestions().map(correctValueOf)).toEqual([OPTION_IDS.first[1], OPTION_IDS.second[1], 'true'])
    expect(correctValueOf({ type: 'true_false', review: { isCorrect: false, pointsAwarded: 0, correctOptionId: null, correctAnswer: false, explanation: null } })).toBe('false')
    expect(correctValueOf({ type: 'true_false', review: { isCorrect: false, pointsAwarded: 0, correctOptionId: null, correctAnswer: null, explanation: null } })).toBeNull()
  })

  it('know a finished attempt and where an attempt opens', () => {
    expect(isFinishedAttempt({ status: 'in_progress' })).toBe(false)
    expect(isFinishedAttempt({ status: 'submitted' })).toBe(true)
    expect(isFinishedAttempt({ status: 'timed_out' })).toBe(true)
    expect(takeExamPath('a b/c')).toBe('/take-exam/a%20b%2Fc')
  })
})
