import { describe, expect, it } from 'vitest'
import { EXAM_QUESTIONS_MAX } from '../api/examQuestions'
import { BANK_QUESTION_IDS, QUESTION_BANK_ID, QUESTION_BANK_NAME, makeBankQuestion, makeLenQuestion, makeQuestionBank, threeExamQuestions } from '../test/examQuestions'
import {
  addQuestions,
  formatHundredths,
  hundredths,
  isOverLimit,
  isRowPointsValid,
  moveRow,
  planQuestionsSave,
  questionSetDiffers,
  removeRow,
  roomLeft,
  rowProblemOf,
  rowProblems,
  rowsOf,
  setRowPoints,
  totalHundredths,
  totalMatchesMaxScore,
} from './examQuestions.set'
import type { QuestionRow } from './examQuestions.set'

const saved = threeExamQuestions()
const rows = () => rowsOf(saved)
const ids = (list: readonly QuestionRow[]) => list.map((row) => row.questionId)
const [first, second, third, fourth, fifth] = BANK_QUESTION_IDS
const bank = makeQuestionBank()

describe('examQuestions.set — the editor’s rows', () => {
  it('starts from the set the server answered: order, points, prompt, type, bank and the bank question’s status', () => {
    expect(rows()).toEqual([
      { questionId: first, points: 4, prompt: saved[0]!.question.prompt, type: 'single_choice', bank: { id: QUESTION_BANK_ID, name: QUESTION_BANK_NAME }, status: 'ready', added: false },
      { questionId: second, points: 3, prompt: saved[1]!.question.prompt, type: 'true_false', bank: { id: QUESTION_BANK_ID, name: QUESTION_BANK_NAME }, status: 'ready', added: false },
      { questionId: third, points: 3, prompt: saved[2]!.question.prompt, type: 'single_choice', bank: { id: QUESTION_BANK_ID, name: QUESTION_BANK_NAME }, status: 'ready', added: false },
    ])
    expect(rowsOf([])).toEqual([])
  })

  it('appends picked questions at the end with their own default points, in the order given, marked as not saved yet', () => {
    const next = addQuestions(rows(), [makeLenQuestion(), makeBankQuestion()], bank)
    expect(ids(next)).toEqual([first, second, third, fifth, fourth])
    expect(next.slice(3)).toEqual([
      { questionId: fifth, points: 1.5, prompt: makeLenQuestion().prompt, type: 'true_false', bank: { id: QUESTION_BANK_ID, name: QUESTION_BANK_NAME }, status: 'ready', added: true },
      { questionId: fourth, points: 2, prompt: makeBankQuestion().prompt, type: 'single_choice', bank: { id: QUESTION_BANK_ID, name: QUESTION_BANK_NAME }, status: 'ready', added: true },
    ])
  })

  it('never links a question twice (exam_questions_invalid): one the set holds, or one picked twice', () => {
    const linkedAgain = makeBankQuestion({ id: first })
    expect(ids(addQuestions(rows(), [linkedAgain, makeBankQuestion(), makeBankQuestion()], bank))).toEqual([first, second, third, fourth])
  })

  it('stops at the limit of an exam and says how much room is left', () => {
    expect(roomLeft(rows())).toBe(EXAM_QUESTIONS_MAX - 3)
    const many = Array.from({ length: EXAM_QUESTIONS_MAX }, (_, index) => makeBankQuestion({ id: `q-${index}` }))
    const full = addQuestions(rows(), many, bank)
    expect(full).toHaveLength(EXAM_QUESTIONS_MAX)
    expect(roomLeft(full)).toBe(0)
    expect(isOverLimit(full)).toBe(false)
    expect(isOverLimit([...full, full[0]!])).toBe(true)
  })

  it('moves a row one place up or down and leaves the ends, and an unknown row, alone', () => {
    expect(ids(moveRow(rows(), third, -1))).toEqual([first, third, second])
    expect(ids(moveRow(rows(), first, 1))).toEqual([second, first, third])
    expect(ids(moveRow(rows(), first, -1))).toEqual([first, second, third])
    expect(ids(moveRow(rows(), third, 1))).toEqual([first, second, third])
    expect(ids(moveRow(rows(), 'unknown', 1))).toEqual([first, second, third])
  })

  it('removes a row and sets a row’s points without touching the others or the rows it was given', () => {
    const original = rows()
    expect(ids(removeRow(original, second))).toEqual([first, third])
    const repointed = setRowPoints(original, second, 2.5)
    expect(repointed.map((row) => row.points)).toEqual([4, 2.5, 3])
    expect(setRowPoints(original, second, null)[1]!.points).toBeNull()
    expect(original.map((row) => row.points)).toEqual([4, 3, 3])
    expect(original).toHaveLength(3)
  })
})

describe('examQuestions.set — a row’s points (ExamQuestionEntryDto)', () => {
  it('accepts 0.01..9999.99 with at most two decimals', () => {
    expect([0.01, 1, 2.5, 9999.99].every(isRowPointsValid)).toBe(true)
    expect([0, -1, 10000, 1.234, 0.001, Number.NaN, Number.POSITIVE_INFINITY, '2', null, undefined].some(isRowPointsValid)).toBe(false)
  })

  it('names what is wrong with a row: no points, or points the server would refuse', () => {
    expect(rowProblemOf({ points: null })).toBe('points_required')
    expect(rowProblemOf({ points: 0 })).toBe('points_invalid')
    expect(rowProblemOf({ points: 1.234 })).toBe('points_invalid')
    expect(rowProblemOf({ points: 2 })).toBeNull()
    const marked = rowProblems(setRowPoints(setRowPoints(rows(), first, null), third, 12345))
    expect([...marked]).toEqual([
      [first, 'points_required'],
      [third, 'points_invalid'],
    ])
    expect(rowProblems(rows()).size).toBe(0)
  })
})

describe('examQuestions.set — the running total (a sum of the editor’s inputs, in whole hundredths)', () => {
  it('adds the points up without the drift of binary fractions', () => {
    expect(hundredths(0.1) + hundredths(0.2)).toBe(30)
    expect(totalHundredths([{ points: 0.1 }, { points: 0.2 }])).toBe(30)
    expect(totalHundredths([{ points: 3.3 }, { points: 3.3 }, { points: 3.4 }])).toBe(1000)
    expect(totalHundredths([{ points: 1.15 }, { points: 2.35 }, { points: 9999.99 }])).toBe(1_000_349)
    expect(totalHundredths(rows())).toBe(1000)
    expect(totalHundredths([])).toBe(0)
  })

  it('counts a cleared field as nothing', () => {
    expect(totalHundredths([{ points: 4 }, { points: null }, { points: 3 }])).toBe(700)
  })

  it('shows whole hundredths as the number they are', () => {
    expect(formatHundredths(1000)).toBe('10')
    expect(formatHundredths(1050)).toBe('10.5')
    expect(formatHundredths(1005)).toBe('10.05')
    expect(formatHundredths(30)).toBe('0.3')
    expect(formatHundredths(0)).toBe('0')
    expect(formatHundredths(1_000_349)).toBe('10003.49')
  })

  it('says whether the points equal the exam’s maximum score exactly (D-R159)', () => {
    expect(totalMatchesMaxScore(rows(), 10)).toBe(true)
    expect(totalMatchesMaxScore(rows(), 10.01)).toBe(false)
    expect(totalMatchesMaxScore(setRowPoints(rows(), first, 3.99), 10)).toBe(false)
    expect(totalMatchesMaxScore([{ points: 0.1 }, { points: 0.2 }], 0.3)).toBe(true)
    expect(totalMatchesMaxScore([{ points: 33.33 }, { points: 33.33 }, { points: 33.34 }], 100)).toBe(true)
    expect(totalMatchesMaxScore([], 10)).toBe(false)
  })
})

describe('examQuestions.set — the one PUT of the whole list (API-271)', () => {
  it('has nothing to save for the set as loaded, for points typed with other zeros and for a change changed back', () => {
    expect(questionSetDiffers(saved, rows())).toBe(false)
    expect(planQuestionsSave(saved, rows())).toEqual({ kind: 'unchanged' })
    expect(planQuestionsSave(saved, setRowPoints(rows(), first, 4.0))).toEqual({ kind: 'unchanged' })
    expect(planQuestionsSave(saved, moveRow(moveRow(rows(), first, 1), first, -1))).toEqual({ kind: 'unchanged' })
    expect(planQuestionsSave(saved, removeRow(addQuestions(rows(), [makeBankQuestion()], bank), fourth))).toEqual({ kind: 'unchanged' })
    expect(planQuestionsSave([], [])).toEqual({ kind: 'unchanged' })
  })

  it('sends the whole ordered list, every entry with its points, after a reorder, other points, an addition or a removal', () => {
    expect(planQuestionsSave(saved, moveRow(rows(), third, -1))).toEqual({
      kind: 'save',
      questions: [
        { questionId: first, points: 4 },
        { questionId: third, points: 3 },
        { questionId: second, points: 3 },
      ],
    })
    expect(planQuestionsSave(saved, setRowPoints(rows(), second, 2.5))).toEqual({
      kind: 'save',
      questions: [
        { questionId: first, points: 4 },
        { questionId: second, points: 2.5 },
        { questionId: third, points: 3 },
      ],
    })
    const added = planQuestionsSave(saved, addQuestions(rows(), [makeBankQuestion()], bank))
    expect(added).toEqual({
      kind: 'save',
      questions: [
        { questionId: first, points: 4 },
        { questionId: second, points: 3 },
        { questionId: third, points: 3 },
        { questionId: fourth, points: 2 },
      ],
    })
    expect(planQuestionsSave(saved, removeRow(rows(), first))).toEqual({
      kind: 'save',
      questions: [
        { questionId: second, points: 3 },
        { questionId: third, points: 3 },
      ],
    })
    // Unlinking everything is a save too: an empty list.
    expect(planQuestionsSave(saved, [])).toEqual({ kind: 'save', questions: [] })
    // The points travel as JSON numbers.
    if (added.kind === 'save') expect(added.questions.every((entry) => typeof entry.points === 'number')).toBe(true)
  })

  it('sends nothing while a row holds points the server would refuse — never an entry without its points', () => {
    const cleared = planQuestionsSave(saved, setRowPoints(rows(), second, null))
    expect(cleared.kind).toBe('invalid')
    if (cleared.kind === 'invalid') expect([...cleared.problems]).toEqual([[second, 'points_required']])
    expect(planQuestionsSave(saved, setRowPoints(rows(), second, 0)).kind).toBe('invalid')
    expect(questionSetDiffers(saved, setRowPoints(rows(), second, null))).toBe(true)
  })

  it('refuses a list longer than an exam takes', () => {
    const many = Array.from({ length: EXAM_QUESTIONS_MAX + 1 }, (_, index) => ({ ...rows()[0]!, questionId: `q-${index}` }))
    expect(planQuestionsSave(saved, many)).toEqual({ kind: 'too_many' })
  })
})
