import { describe, expect, it } from 'vitest'
import type { ExamAttemptStatus } from '../api/examAttempts'
import i18n from '../i18n'
import { ATTEMPT_STUDENT_IDS, fiveAttemptQuestions, fiveAttemptStudents, makeAttemptRow, makeOpenAttemptDetail, makeRegradeSummary } from '../test/examAttempts'
import {
  ATTEMPTS_FILTERS,
  ATTEMPT_STATUS_COLORS,
  RESULT_SOURCE_COLORS,
  WINDOW_STATE_COLORS,
  attemptEndOf,
  attemptsRowMatches,
  filterAttemptsRoster,
  isAnswered,
  optionToneOf,
  questionNumberOf,
  questionOutcomeOf,
  regradeChangedSomething,
  regradeSummaryText,
  shownOptionsOf,
} from './examAttempts.view'

const [SARA, YOUSEF, LAYLA, OMAR, HIND] = ATTEMPT_STUDENT_IDS
const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)
const english = i18n.getFixedT('en')
const tEn = (key: string, options?: Record<string, unknown>) => english(key, options)
const idsOf = (items: { student: { id: string } }[]) => items.map((item) => item.student.id)
const row = (...statuses: ExamAttemptStatus[]) => ({ attempts: statuses.map((status) => ({ status })) })

describe('the local filter of the attempts roster (API-274 takes none)', () => {
  it('keeps the server’s order and tells who did not start, who has an attempt still open and who finished one', () => {
    const items = fiveAttemptStudents()
    expect(ATTEMPTS_FILTERS).toEqual(['all', 'notStarted', 'inProgress', 'finished'])
    expect(idsOf(filterAttemptsRoster(items, 'all'))).toEqual([SARA, YOUSEF, LAYLA, OMAR, HIND])
    expect(idsOf(filterAttemptsRoster(items, 'notStarted'))).toEqual([OMAR, HIND])
    expect(idsOf(filterAttemptsRoster(items, 'inProgress'))).toEqual([YOUSEF])
    // A timed-out attempt is a finished one: the server closed it with what was saved.
    expect(idsOf(filterAttemptsRoster(items, 'finished'))).toEqual([SARA, LAYLA])
    expect(filterAttemptsRoster([], 'finished')).toEqual([])
  })

  it('counts a student as the server’s figures do: a finished attempt and a second one in progress is in both', () => {
    const both = row('submitted', 'in_progress')
    expect(attemptsRowMatches(both, 'inProgress')).toBe(true)
    expect(attemptsRowMatches(both, 'finished')).toBe(true)
    expect(attemptsRowMatches(both, 'notStarted')).toBe(false)
    expect(attemptsRowMatches(row('in_progress'), 'finished')).toBe(false)
    expect(attemptsRowMatches(row('timed_out'), 'inProgress')).toBe(false)
    expect(attemptsRowMatches(row(), 'notStarted')).toBe(true)
    expect(attemptsRowMatches(row(), 'all')).toBe(true)
  })
})

describe('the labels of an attempt', () => {
  it('has a colour for every status, window state and result source the API names', () => {
    expect(Object.keys(ATTEMPT_STATUS_COLORS)).toEqual(['in_progress', 'submitted', 'timed_out'])
    expect(Object.keys(WINDOW_STATE_COLORS)).toEqual(['not_open', 'open', 'closed'])
    expect(Object.keys(RESULT_SOURCE_COLORS)).toEqual(['online', 'manual'])
    for (const status of Object.keys(ATTEMPT_STATUS_COLORS)) expect(t(`examAttempts.status.${status}`)).not.toContain('examAttempts.')
    for (const state of Object.keys(WINDOW_STATE_COLORS)) expect(t(`examAttempts.window.state.${state}`)).not.toContain('examAttempts.')
    for (const source of Object.keys(RESULT_SOURCE_COLORS)) expect(t(`examAttempts.source.${source}`)).not.toContain('examAttempts.')
  })

  it('ends an attempt’s line with the server’s deadline while it is open, with the submission once submitted, and with the server’s close when it timed out', () => {
    const open = makeAttemptRow({ status: 'in_progress', expiresAt: '2026-11-20T07:34:00.000Z', submittedAt: null })
    expect(attemptEndOf(open)).toEqual({ kind: 'deadline', iso: '2026-11-20T07:34:00.000Z' })
    expect(attemptEndOf(makeAttemptRow())).toEqual({ kind: 'submittedAt', iso: '2026-11-20T07:31:00.000Z' })
    expect(attemptEndOf(makeAttemptRow({ status: 'timed_out', submittedAt: '2026-11-20T07:50:00.000Z' }))).toEqual({ kind: 'closedAt', iso: '2026-11-20T07:50:00.000Z' })
    // The server always sends the instant of a finished attempt; without one nothing is made up.
    expect(attemptEndOf(makeAttemptRow({ status: 'submitted', submittedAt: null }))).toBeNull()
    // Every kind has its label in the roster and in the attempt panel.
    for (const kind of ['deadline', 'submittedAt', 'closedAt']) {
      expect(t(`examAttempts.roster.${kind}`)).not.toContain('examAttempts.')
      expect(t(`examAttempts.detail.fields.${kind}`)).not.toContain('examAttempts.')
    }
  })

  it('numbers a question from 1 (the server counts positions from 0)', () => {
    expect(questionNumberOf(0)).toBe(1)
    expect(questionNumberOf(4)).toBe(5)
  })
})

describe('one question of an attempt (API-275)', () => {
  const [first, second, , fourth, fifth] = fiveAttemptQuestions()

  it('takes right and wrong from the server’s verdict, and tells a missing answer from a wrong one', () => {
    expect(questionOutcomeOf(first!)).toBe('correct')
    expect(questionOutcomeOf(second!)).toBe('wrong')
    expect(questionOutcomeOf(fourth!)).toBe('unanswered')
    expect(questionOutcomeOf(fifth!)).toBe('correct')
    // The verdict is the server's even when it disagrees with what the key and the answer would suggest.
    expect(questionOutcomeOf({ ...first!, isCorrect: false })).toBe('wrong')
    expect(questionOutcomeOf({ ...second!, isCorrect: true })).toBe('correct')
    // In progress: nothing is graded, whatever was saved.
    for (const question of makeOpenAttemptDetail().questions) expect(questionOutcomeOf(question)).toBe('ungraded')
  })

  it('knows an answer from none: null, or both fields null', () => {
    expect(isAnswered(null)).toBe(false)
    expect(isAnswered({ optionId: null, value: null })).toBe(false)
    expect(isAnswered({ optionId: 'o-1', value: null })).toBe(true)
    expect(isAnswered({ optionId: null, value: false })).toBe(true)
  })

  it('lists a choice question’s own options in order with the key and the student’s answer marked', () => {
    expect(shownOptionsOf(second!).map((option) => [option.text?.ar, option.isKey, option.isChosen])).toEqual([
      ['def', true, false],
      ['func', false, true],
      ['lambda', false, false],
    ])
    expect(shownOptionsOf(first!).map((option) => [option.isKey, option.isChosen])).toEqual([
      [true, true],
      [false, false],
      [false, false],
    ])
    // Unanswered: the key is marked, nothing is the student's.
    expect(shownOptionsOf(fourth!).map((option) => [option.isKey, option.isChosen])).toEqual([
      [true, false],
      [false, false],
      [false, false],
    ])
    expect(shownOptionsOf(second!).every((option) => option.truth === null)).toBe(true)
  })

  it('lists «true» then «false» for a true/false question, with the key and the student’s value', () => {
    expect(shownOptionsOf(fifth!)).toEqual([
      { key: 'true', text: null, truth: true, isKey: true, isChosen: true },
      { key: 'false', text: null, truth: false, isKey: false, isChosen: false },
    ])
    expect(shownOptionsOf({ ...fifth!, correctAnswer: false, answer: { optionId: null, value: true } }).map((option) => [option.isKey, option.isChosen])).toEqual([
      [false, true],
      [true, false],
    ])
    // No answer: neither value is the student's — `false` is not mistaken for «none».
    expect(shownOptionsOf({ ...fifth!, answer: null }).map((option) => option.isChosen)).toEqual([false, false])
    expect(shownOptionsOf({ ...fifth!, answer: { optionId: null, value: false } }).map((option) => option.isChosen)).toEqual([false, true])
  })

  it('tints the student’s answer by the server’s verdict, the key they did not choose as the key, and nothing else', () => {
    const chosen = { isKey: false, isChosen: true }
    expect(optionToneOf(chosen, true)).toBe('right')
    expect(optionToneOf(chosen, false)).toBe('wrong')
    expect(optionToneOf(chosen, null)).toBe('pending')
    expect(optionToneOf({ isKey: true, isChosen: true }, null)).toBe('pending')
    expect(optionToneOf({ isKey: true, isChosen: false }, false)).toBe('key')
    expect(optionToneOf({ isKey: false, isChosen: false }, false)).toBe('plain')
  })
})

describe('the wording of a regrade’s counts (API-273)', () => {
  it('says what was checked and what changed, each count in its own Arabic plural form', () => {
    expect(regradeSummaryText(t, makeRegradeSummary())).toBe('فُحصت 14 محاولة، وتغيّر تصحيح 3 منها، وتغيّرت نتيجة طالبين.')
    expect(regradeSummaryText(t, { attempts: 1, changedAttempts: 1, changedResults: 1 })).toBe('فُحصت محاولة واحدة، وتغيّر تصحيح واحدة منها، وتغيّرت نتيجة طالب واحد.')
    expect(regradeSummaryText(t, { attempts: 2, changedAttempts: 2, changedResults: 5 })).toBe('فُحصت محاولتان، وتغيّر تصحيح اثنتين منها، وتغيّرت نتيجة 5 طلاب.')
    expect(regradeSummaryText(t, { attempts: 7, changedAttempts: 0, changedResults: 12 })).toBe('فُحصت 7 محاولات، ولم يتغيّر تصحيح أيٍّ منها، وتغيّرت نتيجة 12 طالباً.')
    expect(regradeSummaryText(t, { attempts: 120, changedAttempts: 40, changedResults: 0 })).toBe('فُحصت 120 محاولة، وتغيّر تصحيح 40 منها، ولم تتغيّر نتيجة أي طالب.')
  })

  it('says «no change» when both changed counts are 0, and that nothing was graded when no attempt is finished', () => {
    expect(regradeSummaryText(t, { attempts: 14, changedAttempts: 0, changedResults: 0 })).toBe('فُحصت 14 محاولة — لا تغيير.')
    expect(regradeSummaryText(t, { attempts: 0, changedAttempts: 0, changedResults: 0 })).toBe('لا محاولات منتهية بعد، فلم يُصحَّح شيء.')
    expect(regradeChangedSomething({ attempts: 14, changedAttempts: 0, changedResults: 0 })).toBe(false)
    expect(regradeChangedSomething({ attempts: 14, changedAttempts: 1, changedResults: 0 })).toBe(true)
    expect(regradeChangedSomething({ attempts: 14, changedAttempts: 0, changedResults: 1 })).toBe(true)
  })

  it('reads in English with «1 attempt» and «2 attempts»', () => {
    expect(regradeSummaryText(tEn, makeRegradeSummary())).toBe('Checked 14 attempts, the grading of 3 of them changed, and the result of 2 students changed.')
    expect(regradeSummaryText(tEn, { attempts: 1, changedAttempts: 1, changedResults: 1 })).toBe('Checked 1 attempt, the grading of 1 of them changed, and the result of 1 student changed.')
    expect(regradeSummaryText(tEn, { attempts: 9, changedAttempts: 0, changedResults: 0 })).toBe('Checked 9 attempts — no change.')
  })
})
