// Pure presentation helpers of the exam page (MOD-09 phase 2): the choices of
// a question as its radio group lists them, and — for a finished attempt whose
// review the server released — which of them the SERVER named as correct.
// Nothing here decides what is right: correctValueOf() only reads
// `question.review`, which is null until the exam reveals its answers
// (D-R157). Unit-tested in takeExam.answers.test.ts. No React.
import type { AttemptAnswer, ExamAttemptStatus } from '../api/examAttempts'
import type { AttemptQuestion, AttemptSummary } from '../api/myAttempts'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'
import { booleanAnswer, choiceAnswer } from './takeExam.answers'

/** One thing a learner can choose for a question. */
export interface Choice {
  /** The value of its radio button: the option's id, or `'true'` / `'false'`. */
  value: string
  label: string
  /** The whole answer choosing it gives the question. */
  answer: AttemptAnswer
}

/** The choices of a question in display order: its options, or «true» / «false». */
export function choicesOf(question: Pick<AttemptQuestion, 'type' | 'options'>, words: { trueOption: string; falseOption: string }, language: Language): Choice[] {
  if (question.type === 'true_false') {
    return [
      { value: 'true', label: words.trueOption, answer: booleanAnswer(true) },
      { value: 'false', label: words.falseOption, answer: booleanAnswer(false) },
    ]
  }
  return question.options.map((option) => ({ value: option.id, label: localizedLabel(option.text, language), answer: choiceAnswer(option.id) }))
}

/** The radio value the server named as the correct one — null while it has not released the review. */
export function correctValueOf(question: Pick<AttemptQuestion, 'type' | 'review'>): string | null {
  const review = question.review
  if (review === null) return null
  if (question.type === 'true_false') return review.correctAnswer === null ? null : review.correctAnswer ? 'true' : 'false'
  return review.correctOptionId
}

/** antd `Tag` colours of an attempt's status. */
export const ATTEMPT_STATUS_COLORS: Readonly<Record<ExamAttemptStatus, string>> = {
  in_progress: 'processing',
  submitted: 'green',
  timed_out: 'orange',
}

/** True for an attempt the server has closed (submitted by the learner, or closed at the deadline). */
export function isFinishedAttempt(attempt: Pick<AttemptSummary, 'status'>): boolean {
  return attempt.status !== 'in_progress'
}

/** Where an attempt is taken, continued or read. */
export function takeExamPath(attemptId: string): string {
  return `/take-exam/${encodeURIComponent(attemptId)}`
}

/** «My exams». */
export const MY_EXAMS_ROUTE = '/my-exams'
