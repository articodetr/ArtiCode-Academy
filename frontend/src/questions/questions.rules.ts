// The rules of a bank question, as the editor checks them before any request
// (MOD-09 phase 2 — OEX-T07; decisions D-R163/D-R164). A MANUAL MIRROR of
// backend/src/questions/questions.rules.ts — keep in sync:
//
//   - Two auto-graded types. A `single_choice` question carries 2..10 options
//     with exactly one correct and no boolean key; a `true_false` question
//     carries no options and its key in `correctAnswer`.
//   - Three statuses. A `draft` may be incomplete — it only has to be
//     well-formed (nothing that belongs to the other type, at most ten options,
//     at most one correct, no two options with the same Arabic text); a `ready`
//     question also passes the completeness rules of its type; an `archived`
//     question keeps whatever it had.
//   - Tags are stored trimmed, single-spaced, lower-cased and without repeats.
//   - A PATCH is a smallest diff: the options are compared as one ordered list
//     (text and key), the points as `numeric(6,2)` text.
//
// The server stays the boundary: what it refuses comes back as `question_invalid
// { problems }` in the same vocabulary (QUESTION_PROBLEMS of api/questionBanks.ts)
// and is mapped onto the form problem by problem. Pure; unit-tested in
// questions.rules.test.ts.
import { QUESTION_OPTIONS_MAX, QUESTION_OPTIONS_MIN, QUESTION_PROBLEMS } from '../api/questionBanks'
import type { QuestionProblem, QuestionStatus, QuestionType } from '../api/questionBanks'
import type { LocalizedLabel } from '../api/users'
import { sameLabel } from '../courses/courses.form'

/** An option as the rules see it (`OptionContent` of the backend): its text and whether it is the key. */
export interface OptionContent {
  text: LocalizedLabel
  isCorrect: boolean
}

/** What the rules look at: the type, the status the question would have, and its key. */
export interface QuestionContent {
  type: QuestionType
  status: QuestionStatus
  options: readonly OptionContent[]
  /** The key of a `true_false` question; null for a draft that has none yet and for any other type. */
  correctAnswer: boolean | null
}

function comparable(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar')
}

/** True when two options show the same Arabic text (trimmed, single-spaced, case-insensitive). */
export function hasDuplicateOptions(options: readonly OptionContent[]): boolean {
  const seen = new Set<string>()
  for (const option of options) {
    const key = comparable(option.text.ar)
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

/**
 * The rules the content breaks, in catalogue order; an empty list = valid.
 * Well-formedness applies in every status, completeness only to `ready`.
 */
export function questionProblems(content: QuestionContent): QuestionProblem[] {
  const problems = new Set<QuestionProblem>()
  const correct = content.options.filter((option) => option.isCorrect).length
  if (content.type === 'true_false') {
    if (content.options.length > 0) problems.add('options_not_allowed')
    if (content.status === 'ready' && content.correctAnswer === null) problems.add('correct_answer_required')
  } else {
    if (content.correctAnswer !== null) problems.add('correct_answer_not_allowed')
    if (content.options.length > QUESTION_OPTIONS_MAX) problems.add('options_too_many')
    if (correct > 1) problems.add('multiple_correct_options')
    if (hasDuplicateOptions(content.options)) problems.add('duplicate_options')
    if (content.status === 'ready') {
      if (content.options.length < QUESTION_OPTIONS_MIN) problems.add('options_too_few')
      if (correct === 0) problems.add('correct_option_required')
    }
  }
  return QUESTION_PROBLEMS.filter((problem) => problems.has(problem))
}

/** Trimmed, single-spaced, lower-cased tags without blanks or repeats, in first-seen order — what the server stores. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ').toLowerCase()
    if (tag === '' || seen.has(tag)) continue
    seen.add(tag)
    result.push(tag)
  }
  return result
}

/** `numeric(6,2)` text of a JSON number — how the server compares the points of a PATCH with the stored ones. */
export function pointsText(value: number): string {
  return value.toFixed(2)
}

/** Options are equal when they are the same texts with the same key, in the same order. */
export function sameOptions(a: readonly OptionContent[], b: readonly OptionContent[]): boolean {
  return a.length === b.length && a.every((option, index) => option.isCorrect === b[index]!.isCorrect && sameLabel(option.text, b[index]!.text))
}

/** Tags are equal when they are the same labels in the same order. */
export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index])
}
