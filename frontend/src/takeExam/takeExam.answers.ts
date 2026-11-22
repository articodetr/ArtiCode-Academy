// The learner's answers as the exam page holds them (MOD-09 phase 2): pure
// rules, unit-tested in takeExam.answers.test.ts.
//
// An answer is the WHOLE answer of its question, in the shape the server
// stores and returns it (`AttemptAnswerDto`): `optionId` for a `single_choice`
// question, `value` for a `true_false` one, `null` while unanswered. Saving an
// answer sends exactly that (API-278): `{ examQuestionId, optionId }`,
// `{ examQuestionId, value }` — a JSON boolean — or, to clear it, an entry
// with neither field.
//
// Nothing here knows which answer is right: the page never computes, guesses
// or fetches a key (SEC-R-24). No React, no i18next instance.
import type { AttemptAnswer } from '../api/examAttempts'
import type { AnswerEntry, AttemptQuestion } from '../api/myAttempts'

/** The whole answer of one question on screen; null = unanswered (or cleared). */
export type LocalAnswer = AttemptAnswer | null

/** The answers on screen, by question id (`questions[].id`). A question without an entry is unanswered. */
export type AnswerMap = ReadonlyMap<string, LocalAnswer>

/** The answer that names an option of a `single_choice` question. */
export function choiceAnswer(optionId: string): AttemptAnswer {
  return { optionId, value: null }
}

/** The answer to a `true_false` question. */
export function booleanAnswer(value: boolean): AttemptAnswer {
  return { optionId: null, value }
}

/** True when the answer names an option or a boolean. */
export function isAnswered(answer: LocalAnswer | undefined): boolean {
  return answer !== null && answer !== undefined && (answer.optionId !== null || answer.value !== null)
}

/** Two answers that would be saved as the same thing. */
export function sameAnswer(a: LocalAnswer | undefined, b: LocalAnswer | undefined): boolean {
  const left = isAnswered(a) ? a! : null
  const right = isAnswered(b) ? b! : null
  if (left === null || right === null) return left === right
  return left.optionId === right.optionId && left.value === right.value
}

/** One answer as API-278 takes it; with neither field it clears the question's answer. */
export function entryOf(questionId: string, answer: LocalAnswer): AnswerEntry {
  if (answer !== null && answer.optionId !== null) return { examQuestionId: questionId, optionId: answer.optionId }
  if (answer !== null && answer.value !== null) return { examQuestionId: questionId, value: answer.value }
  return { examQuestionId: questionId }
}

/** The answers the server holds, as it sent them with the attempt. */
export function answersOf(questions: readonly Pick<AttemptQuestion, 'id' | 'answer'>[]): Map<string, LocalAnswer> {
  return new Map(questions.map((question) => [question.id, isAnswered(question.answer) ? question.answer : null]))
}

/**
 * The answers to show after the attempt was read again while it is in progress: the server's, except for the questions
 * whose change has not reached it yet (`unsaved` — sent or waiting). A question the queue does not hold was saved, so
 * the server's word for it is the newer one (another tab of the same learner).
 */
export function reconcileAnswers(questions: readonly Pick<AttemptQuestion, 'id' | 'answer'>[], unsaved: AnswerMap): Map<string, LocalAnswer> {
  const answers = answersOf(questions)
  for (const [questionId, answer] of unsaved) if (answers.has(questionId)) answers.set(questionId, answer)
  return answers
}

/** How many of the questions hold an answer on screen. */
export function answeredCount(questions: readonly Pick<AttemptQuestion, 'id'>[], answers: AnswerMap): number {
  return questions.filter((question) => isAnswered(answers.get(question.id))).length
}

/** The positions (1-based, in the exam's order) of the questions without an answer. */
export function unansweredNumbers(questions: readonly Pick<AttemptQuestion, 'id'>[], answers: AnswerMap): number[] {
  return questions.flatMap((question, index) => (isAnswered(answers.get(question.id)) ? [] : [index + 1]))
}

/** Where the page opens an attempt: the first question without an answer, the first one when all are answered. */
export function openingIndex(questions: readonly Pick<AttemptQuestion, 'id'>[], answers: AnswerMap): number {
  const first = questions.findIndex((question) => !isAnswered(answers.get(question.id)))
  return first === -1 ? 0 : first
}

/**
 * The positions (1-based) of the questions whose answer on screen is not the one the server holds — asked once an
 * attempt has closed, to say honestly which last changes did not reach it. It compares the learner's own answers
 * only; it says nothing about which answer is right.
 */
export function unsavedNumbers(questions: readonly Pick<AttemptQuestion, 'id' | 'answer'>[], answers: AnswerMap): number[] {
  return questions.flatMap((question, index) => (answers.has(question.id) && !sameAnswer(answers.get(question.id), question.answer) ? [index + 1] : []))
}

/** The value of a question's radio group: the option id, `'true'` / `'false'`, or '' while unanswered. */
export function radioValueOf(answer: LocalAnswer | undefined): string {
  if (!isAnswered(answer)) return ''
  if (answer!.optionId !== null) return answer!.optionId
  return answer!.value ? 'true' : 'false'
}

/** The state of one question in the navigator. */
export type QuestionMark = 'answered' | 'unanswered'

export function questionMark(answer: LocalAnswer | undefined): QuestionMark {
  return isAnswered(answer) ? 'answered' : 'unanswered'
}
