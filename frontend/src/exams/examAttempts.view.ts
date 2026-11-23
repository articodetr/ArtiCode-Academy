// Pure rules of the «attempts» tab of the exam drawer (MOD-09 phase 2 —
// OEX-T07), unit-tested in examAttempts.view.test.ts: the local filter of the
// roster of API-274, the labels and colours of an attempt, how a question of
// API-275 is shown (its options, the key, the student's answer, the server's
// verdict) and the wording of a regrade's counts (API-273). API-274 takes no
// filter and has no pagination (a class's roster is bounded by its capacity),
// so the tab filters the rows it loaded — exact, since it holds the whole
// roster — by the same definitions the server's figures use
// (ExamAttemptsService.statsOf()): a student «started» with any attempt, is «in
// progress» with an attempt still open, and «finished» with a finished one, so
// a student with a finished attempt and a second one in progress is in both.
// Nothing here computes a score, a mean, a rate or a verdict: right and wrong
// are the server's `isCorrect`, never the answer compared with the key. No
// React, no i18next instance — callers pass `t`.
import type { AttemptAnswer, ExamAttemptRow, ExamAttemptStatus, ExamWindowState, TeacherAttemptQuestion } from '../api/examAttempts'
import type { RegradeSummary } from '../api/examQuestions'
import type { ExamResultSource } from '../api/examResults'
import type { LocalizedLabel } from '../api/users'
import type { Translate } from '../users/users.format'

/** `notStarted` = no attempt yet; `inProgress` = an attempt still open on the server; `finished` = a submitted or timed-out attempt. */
export const ATTEMPTS_FILTERS = ['all', 'notStarted', 'inProgress', 'finished'] as const
export type AttemptsFilter = (typeof ATTEMPTS_FILTERS)[number]

/** What the filter reads of a roster row: the statuses of the student's attempts. */
type RosterRow = { attempts: readonly Pick<ExamAttemptRow, 'status'>[] }

export function attemptsRowMatches(item: RosterRow, filter: AttemptsFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'notStarted':
      return item.attempts.length === 0
    case 'inProgress':
      return item.attempts.some((attempt) => attempt.status === 'in_progress')
    case 'finished':
      return item.attempts.some((attempt) => attempt.status !== 'in_progress')
  }
}

/** The rows of `items` the filter keeps, in the server's (enrollment) order. */
export function filterAttemptsRoster<T extends RosterRow>(items: readonly T[], filter: AttemptsFilter): T[] {
  return items.filter((item) => attemptsRowMatches(item, filter))
}

/** antd `Tag` colours of an attempt's status (`examAttempts.status.*` carries the texts). */
export const ATTEMPT_STATUS_COLORS: Readonly<Record<ExamAttemptStatus, string>> = {
  in_progress: 'processing',
  submitted: 'green',
  timed_out: 'orange',
}

/** antd `Tag` colours of where the server clock falls in the exam's window (`examAttempts.window.state.*`). */
export const WINDOW_STATE_COLORS: Readonly<Record<ExamWindowState, string>> = {
  not_open: 'gold',
  open: 'green',
  closed: 'default',
}

/** antd `Tag` colours of a result's source (`examAttempts.source.*`): the attempts tab and the results sheet share them. */
export const RESULT_SOURCE_COLORS: Readonly<Record<ExamResultSource, string>> = {
  online: 'geekblue',
  manual: 'default',
}

/** The number a question is shown with: `sortOrder` counts from 0, people from 1. */
export function questionNumberOf(sortOrder: number): number {
  return sortOrder + 1
}

/**
 * The instant an attempt's line ends with and what it is: an attempt still
 * open shows the server's `deadline`; a submitted one when it was
 * `submittedAt`; a timed-out one when the server closed it (`closedAt` — its
 * deadline, with what was saved). Null for a finished attempt without the
 * instant (the server always sends one).
 */
export interface AttemptEnd {
  kind: 'deadline' | 'submittedAt' | 'closedAt'
  iso: string
}

export function attemptEndOf(attempt: Pick<ExamAttemptRow, 'status' | 'submittedAt' | 'expiresAt'>): AttemptEnd | null {
  if (attempt.status === 'in_progress') return { kind: 'deadline', iso: attempt.expiresAt }
  if (attempt.submittedAt === null) return null
  return { kind: attempt.status === 'timed_out' ? 'closedAt' : 'submittedAt', iso: attempt.submittedAt }
}

/** True when the student gave the question an answer (API-275 sends null, or both fields null, for none). */
export function isAnswered(answer: AttemptAnswer | null): boolean {
  return answer !== null && (answer.optionId !== null || answer.value !== null)
}

/** `ungraded` while the attempt is in progress; otherwise the server's verdict, a missing answer told apart from a wrong one. */
export type QuestionOutcome = 'ungraded' | 'correct' | 'wrong' | 'unanswered'

export function questionOutcomeOf(question: Pick<TeacherAttemptQuestion, 'isCorrect' | 'answer'>): QuestionOutcome {
  if (question.isCorrect === null) return 'ungraded'
  if (question.isCorrect) return 'correct'
  return isAnswered(question.answer) ? 'wrong' : 'unanswered'
}

/** One choice of a question as the detail panel lists it. */
export interface ShownOption {
  key: string
  /** The option's own text; null for the two choices of a `true_false` question, worded from `truth`. */
  text: LocalizedLabel | null
  /** The value a `true_false` choice stands for; null for an option of a `single_choice` question. */
  truth: boolean | null
  /** The key: the correct answer as the exam's frozen copy holds it now. */
  isKey: boolean
  /** The student's answer. */
  isChosen: boolean
}

/** The choices of a question in display order: its own options, or «true» then «false». */
export function shownOptionsOf(question: Pick<TeacherAttemptQuestion, 'type' | 'options' | 'correctAnswer' | 'answer'>): ShownOption[] {
  if (question.type === 'true_false') {
    return [true, false].map((truth) => ({
      key: String(truth),
      text: null,
      truth,
      isKey: question.correctAnswer === truth,
      isChosen: question.answer?.value === truth,
    }))
  }
  return question.options.map((option) => ({
    key: option.id,
    text: option.text,
    truth: null,
    isKey: option.isCorrect,
    isChosen: question.answer !== null && question.answer.optionId === option.id,
  }))
}

/**
 * How a choice is tinted. The student's answer follows the server's verdict on
 * the question — `right`, `wrong`, or `pending` while nothing is graded — never
 * a comparison with the key made here; the key the student did not choose is
 * `key`; any other choice is `plain`.
 */
export type OptionTone = 'key' | 'right' | 'wrong' | 'pending' | 'plain'

export function optionToneOf(option: Pick<ShownOption, 'isKey' | 'isChosen'>, isCorrect: boolean | null): OptionTone {
  if (option.isChosen) return isCorrect === null ? 'pending' : isCorrect ? 'right' : 'wrong'
  return option.isKey ? 'key' : 'plain'
}

/** True when a regrade rewrote something: the grading of an attempt, or a student's counted result. */
export function regradeChangedSomething(summary: RegradeSummary): boolean {
  return summary.changedAttempts > 0 || summary.changedResults > 0
}

/**
 * The server's counts of a regrade in words (`examAttempts.regrade.done.*`),
 * each count worded by its own plural form: «فُحصت 14 محاولة، وتغيّر تصحيح 3
 * منها، وتغيّرت نتيجة طالبين.», «… — لا تغيير.» when both changed counts are 0,
 * and that nothing was graded when no attempt is finished yet.
 */
export function regradeSummaryText(t: Translate, summary: RegradeSummary): string {
  const changed = regradeChangedSomething(summary)
  if (summary.attempts === 0 && !changed) return t('examAttempts.regrade.done.nothing')
  const attempts = t('examAttempts.regrade.done.attempts', { count: summary.attempts })
  if (!changed) return t('examAttempts.regrade.done.unchanged', { attempts })
  return t('examAttempts.regrade.done.changed', {
    attempts,
    changedAttempts: t('examAttempts.regrade.done.changedAttempts', { count: summary.changedAttempts }),
    changedResults: t('examAttempts.regrade.done.changedResults', { count: summary.changedResults }),
  })
}
