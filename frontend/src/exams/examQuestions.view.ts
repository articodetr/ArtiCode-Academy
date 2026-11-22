// What the «الأسئلة» tab of the exam drawer shows of a question of API-270
// (MOD-09 phase 2), and the body of a key correction (API-272). Three readings
// of the same item:
//
//   - answerChoicesOf(): its answers with the key marked — the frozen view and
//     the choices of «تصحيح المفتاح». A `single_choice` question lists its own
//     options; a `true_false` one the two answers, worded by the screen;
//   - previewQuestionsOf(): the question as a learner is served it (the shape
//     of `MyAttemptDto.questions`) — prompt, points and choices WITHOUT the key,
//     the explanation or the corrections. The preview is built from this
//     projection only, so it cannot show what a learner must not see;
//   - buildCorrectKeyInput(): the field of the question's type — one of its own
//     option ids, or a JSON boolean — with the trimmed reason (1–500).
//
// Pure; unit-tested in examQuestions.view.test.ts.
import { CORRECTION_REASON_MAX_LENGTH } from '../api/examQuestions'
import type { CorrectKeyInput, ExamQuestionContent, ExamQuestionItem } from '../api/examQuestions'
import type { QuestionType } from '../api/questionBanks'
import type { LocalizedLabel } from '../api/users'

/** The radio values of the two answers of a `true_false` question. */
export const TRUE_CHOICE = 'true'
export const FALSE_CHOICE = 'false'

/** One answer a learner can give to a question, without its key. */
export interface PreviewChoice {
  /** The option's id, or TRUE_CHOICE / FALSE_CHOICE — the value of its radio. */
  value: string
  /** The option's text; null for the two answers of a `true_false` question (the screen words them). */
  text: LocalizedLabel | null
  /** For a `true_false` question: which answer this is. */
  answer: boolean | null
}

/** An answer with whether it is the key now — the teacher's side only. */
export interface AnswerChoice extends PreviewChoice {
  isKey: boolean
}

/** The answers of a question in display order, the key marked. */
export function answerChoicesOf(question: Pick<ExamQuestionContent, 'type' | 'options' | 'correctAnswer'>): AnswerChoice[] {
  if (question.type === 'true_false') {
    return [
      { value: TRUE_CHOICE, text: null, answer: true, isKey: question.correctAnswer === true },
      { value: FALSE_CHOICE, text: null, answer: false, isKey: question.correctAnswer === false },
    ]
  }
  return question.options.map((option) => ({ value: option.id, text: option.text, answer: null, isKey: option.isCorrect }))
}

/** The value of the choice that is the key now; undefined for a question without one. */
export function keyChoiceOf(question: Pick<ExamQuestionContent, 'type' | 'options' | 'correctAnswer'>): string | undefined {
  return answerChoicesOf(question).find((choice) => choice.isKey)?.value
}

/** A question as a learner is served it: no key, no explanation, no history of corrections. */
export interface PreviewQuestion {
  /** The id of the exam's question. */
  id: string
  points: number
  type: QuestionType
  prompt: LocalizedLabel
  choices: PreviewChoice[]
}

/** The questions of API-270 as a learner will see them, in the same order. */
export function previewQuestionsOf(items: readonly ExamQuestionItem[]): PreviewQuestion[] {
  return items.map((item) => ({
    id: item.id,
    points: item.points,
    type: item.question.type,
    prompt: item.question.prompt,
    // Named fields only: `isKey` (and with it `isCorrect` / `correctAnswer`) never crosses into the preview.
    choices: answerChoicesOf(item.question).map(({ value, text, answer }) => ({ value, text, answer })),
  }))
}

/** A correction's reason: 1–500 characters after trimming (`CorrectKeyDto`). */
export function isCorrectionReasonValid(reason: string | undefined): boolean {
  const length = (reason ?? '').trim().length
  return length >= 1 && length <= CORRECTION_REASON_MAX_LENGTH
}

/**
 * The body of API-272 for the chosen answer and the typed reason, or null while
 * either is missing: `correctOptionId` for a `single_choice` question,
 * `correctAnswer` (a JSON boolean) for a `true_false` one — never both.
 */
export function buildCorrectKeyInput(type: QuestionType, choice: string | undefined, reason: string | undefined): CorrectKeyInput | null {
  if (!choice || !isCorrectionReasonValid(reason)) return null
  const trimmed = (reason ?? '').trim()
  if (type === 'true_false') return choice === TRUE_CHOICE || choice === FALSE_CHOICE ? { correctAnswer: choice === TRUE_CHOICE, reason: trimmed } : null
  return { correctOptionId: choice, reason: trimmed }
}
