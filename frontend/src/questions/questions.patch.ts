// The smallest PATCH of a question (API-268 — MOD-09 phase 2, OEX-T07), on the
// pattern of exams/exams.patch.ts: only the fields whose value differs from the
// question as the server holds it, compared as planQuestionUpdate() of the
// backend compares them (questions.rules.ts mirrors it) — a localized text as a
// whole object, keeping a Turkish text the form does not edit; the points at
// two decimals; the tags as the server stores them; the options as ONE ordered
// list of texts and keys. `null` clears the explanation, the difficulty and the
// key of a true/false question. The options travel as the whole ordered list
// and only when they differ; the status travels only when the save names
// another one than the question has. Nothing changed → null (no request). The
// type is fixed at creation and is never sent. Whether the editor holds unsaved
// work at all (its guard) is questionFormHasChanges(). Pure; unit-tested in
// questions.patch.test.ts.
import type { Question, QuestionCreateStatus, QuestionStatus, UpdateQuestionInput } from '../api/questionBanks'
import { englishWithoutArabic, localizedOf, sameLabel } from '../courses/courses.form'
import { NO_DIFFICULTY, newQuestionHasWork, optionRowIssue, optionsOf } from './questions.form'
import type { QuestionFormValues } from './questions.form'
import { normalizeTags, pointsText, sameOptions, sameTags } from './questions.rules'

/**
 * What a save does to the status: «save as draft», «save and make it ready»,
 * or `keep` — the one save of an archived question, which stays archived.
 */
export type SaveTarget = QuestionCreateStatus | 'keep'

/** The status the rules are checked for: the one the save names, else the one the question has (a new question is a draft). */
export function statusAfterSave(question: Pick<Question, 'status'> | null, target: SaveTarget): QuestionStatus {
  if (target !== 'keep') return target
  return question?.status ?? 'draft'
}

/** The smallest PATCH body (API-268) of the editor saved with `target`, or null when nothing changed. */
export function planQuestionPatch(question: Question, values: QuestionFormValues, target: SaveTarget): UpdateQuestionInput | null {
  const body: UpdateQuestionInput = {}
  if (target !== 'keep' && target !== question.status) body.status = target
  const prompt = localizedOf(values.promptAr, values.promptEn, question.prompt.tr)
  if (prompt && !sameLabel(prompt, question.prompt)) body.prompt = prompt
  const explanation = localizedOf(values.explanationAr, values.explanationEn, question.explanation?.tr)
  if (!sameLabel(explanation, question.explanation)) body.explanation = explanation
  if (typeof values.points === 'number' && pointsText(values.points) !== pointsText(question.points)) body.points = values.points
  const difficulty = !values.difficulty || values.difficulty === NO_DIFFICULTY ? null : values.difficulty
  if (difficulty !== question.difficulty) body.difficulty = difficulty
  const tags = normalizeTags(values.tags ?? [])
  if (!sameTags(tags, question.tags)) body.tags = tags
  if (question.type === 'single_choice') {
    // The whole ordered list, or nothing: the server replaces every option at once.
    const options = optionsOf(values.options)
    if (!sameOptions(options, question.options)) body.options = options
  } else {
    const answer = values.correctAnswer ?? null
    if (answer !== question.correctAnswer) body.correctAnswer = answer
  }
  return Object.keys(body).length > 0 ? body : null
}

const isBlank = (value: string | undefined) => typeof value === 'string' && value.trim() === ''

/**
 * Whether the editor holds unsaved work (the rule of examFormHasChanges() —
 * KI-058), always compared with what the server holds, so a field changed back
 * holds nothing and spaces around a text are no change (the save trims them).
 * A new question: anything written or chosen beyond its untouched start (the
 * type alone is a choice, not work). An existing one: the smallest PATCH that
 * keeps its status is non-empty, or the form holds what the save would refuse
 * instead of sending — an emptied Arabic prompt, an English explanation without
 * its Arabic text, emptied points, or an option row that cannot be sent.
 */
export function questionFormHasChanges(question: Question | null, values: QuestionFormValues): boolean {
  if (!question) return newQuestionHasWork(values)
  return (
    isBlank(values.promptAr) ||
    englishWithoutArabic(values.explanationAr, values.explanationEn) ||
    values.points === null ||
    (question.type === 'single_choice' && (values.options ?? []).some((row) => optionRowIssue(row) !== null)) ||
    planQuestionPatch(question, values, 'keep') !== null
  )
}
