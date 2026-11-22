// Question form ↔ API-266 body (MOD-09 phase 2 — OEX-T07), on the pattern of
// exams/exams.form.ts and grades/gradeSchemes.form.ts. The editor holds the
// whole question: its type (chosen at creation only), the prompt and the
// explanation as Arabic/English pairs, the points, the difficulty (`none` = no
// difficulty), the tags as the server will store them, the rows of the options
// editor (single choice) and the key of a true/false question.
//
// A row of the options editor nobody wrote in is not an option yet: it is
// never sent — in a draft or in a ready question — and it is no change. A row
// with an Arabic text is an option; a row the form cannot send (an English text
// without its Arabic one, or the «correct» mark on a row without a text) is
// refused on its field before any request (optionRowIssue()).
//
// A localized text travels as a whole `{ ar, en? }` object and keeps a Turkish
// text the form does not show (an option's rides along with its row). The
// create body carries what was filled in, plus the points and the status the
// save button names — neither is left to a server default. The smallest PATCH
// is planned in questions.patch.ts. Pure; unit-tested in questions.form.test.ts.
import { QUESTION_OPTIONS_MIN } from '../api/questionBanks'
import type { CreateQuestionInput, Question, QuestionCreateStatus, QuestionDifficulty, QuestionOptionInput, QuestionProblem, QuestionStatus, QuestionType } from '../api/questionBanks'
import { localizedOf } from '../courses/courses.form'
import { normalizeTags, questionProblems } from './questions.rules'
import type { OptionContent, QuestionContent } from './questions.rules'

/** One row of the options editor. */
export interface OptionFormValues {
  textAr?: string
  textEn?: string
  /** The loaded option's Turkish text: not shown (the form edits Arabic and English), kept with its row. */
  textTr?: string
  /** The one row the radio marks as the key. */
  isCorrect?: boolean
}

/** The difficulty select: the three levels, or `none` for a question without one. */
export type DifficultyChoice = QuestionDifficulty | 'none'

export const NO_DIFFICULTY = 'none'

export interface QuestionFormValues {
  /** Chosen at creation; fixed afterwards (the edit form shows it and never changes it). */
  type: QuestionType
  promptAr: string
  promptEn?: string
  explanationAr?: string
  explanationEn?: string
  /** An InputNumber value: null once cleared. */
  points: number | null
  difficulty: DifficultyChoice
  /** As the server stores them: trimmed, lower-cased, without repeats (the field normalises on every change). */
  tags: string[]
  /** `single_choice`: the rows of the options editor, in display order. */
  options: OptionFormValues[]
  /** `true_false`: the key; null = not chosen yet. */
  correctAnswer: boolean | null
}

/** The server's default when `points` is absent — the form shows it instead of leaving it to the server. */
export const DEFAULT_QUESTION_POINTS = 1
/** A new single-choice question starts with the four rows of a usual question; an unwritten row is never sent. */
export const NEW_QUESTION_OPTION_ROWS = 4

const text = (value: string | undefined) => (value ?? '').trim()

/** A row added in the editor: nothing written, not the key. */
export function emptyOption(): OptionFormValues {
  return { textAr: '', textEn: '', isCorrect: false }
}

/** The form of a new question: single choice, one point, four empty rows. */
export function newQuestionForm(): QuestionFormValues {
  return {
    type: 'single_choice',
    promptAr: '',
    promptEn: '',
    explanationAr: '',
    explanationEn: '',
    points: DEFAULT_QUESTION_POINTS,
    difficulty: NO_DIFFICULTY,
    tags: [],
    options: Array.from({ length: NEW_QUESTION_OPTION_ROWS }, emptyOption),
    correctAnswer: null,
  }
}

/** Initial form values of a loaded question; a single-choice question always shows at least two rows. */
export function questionFormValuesOf(question: Question): QuestionFormValues {
  const options: OptionFormValues[] = []
  if (question.type === 'single_choice') {
    for (const option of question.options) {
      options.push({ textAr: option.text.ar, textEn: option.text.en ?? '', ...(option.text.tr ? { textTr: option.text.tr } : {}), isCorrect: option.isCorrect })
    }
    while (options.length < QUESTION_OPTIONS_MIN) options.push(emptyOption())
  }
  return {
    type: question.type,
    promptAr: question.prompt.ar,
    promptEn: question.prompt.en ?? '',
    explanationAr: question.explanation?.ar ?? '',
    explanationEn: question.explanation?.en ?? '',
    points: question.points,
    difficulty: question.difficulty ?? NO_DIFFICULTY,
    tags: [...question.tags],
    options,
    correctAnswer: question.type === 'true_false' ? question.correctAnswer : null,
  }
}

/** A row nobody wrote in: no Arabic text, no English text, and not marked as the key. */
export function isBlankOption(row: OptionFormValues | undefined): boolean {
  return text(row?.textAr) === '' && text(row?.textEn) === '' && row?.isCorrect !== true
}

/** Why a written row cannot be sent: an English text without its Arabic one, or the «correct» mark on a row without a text. */
export type OptionRowIssue = 'optionArabicFirst' | 'correctOptionBlank'

export function optionRowIssue(row: OptionFormValues | undefined): OptionRowIssue | null {
  if (text(row?.textAr) !== '') return null
  if (text(row?.textEn) !== '') return 'optionArabicFirst'
  return row?.isCorrect === true ? 'correctOptionBlank' : null
}

/** The rows with only `index` marked as the key — a question has one correct option. */
export function markCorrectOption(rows: readonly OptionFormValues[], index: number): OptionFormValues[] {
  return rows.map((row, at) => ({ ...row, isCorrect: at === index }))
}

/** The options the rows spell, in display order: every row with an Arabic text. */
export function optionsOf(rows: readonly (OptionFormValues | undefined)[] | undefined): OptionContent[] {
  return (rows ?? []).flatMap((row) => {
    const label = localizedOf(row?.textAr, row?.textEn, row?.textTr)
    return label ? [{ text: label, isCorrect: row?.isCorrect === true }] : []
  })
}

/** The question as the rules see it, were it saved with `status`: the options of a single-choice question, the key of a true/false one. */
export function questionContentOf(values: Pick<QuestionFormValues, 'type' | 'options' | 'correctAnswer'>, status: QuestionStatus): QuestionContent {
  if (values.type === 'true_false') return { type: 'true_false', status, options: [], correctAnswer: values.correctAnswer ?? null }
  return { type: 'single_choice', status, options: optionsOf(values.options), correctAnswer: null }
}

/** What the server would refuse were the form saved with `status` (the mirror — questions.rules.ts); empty = it would pass. */
export function formProblems(values: Pick<QuestionFormValues, 'type' | 'options' | 'correctAnswer'>, status: QuestionStatus): QuestionProblem[] {
  return questionProblems(questionContentOf(values, status))
}

/**
 * Where the editor shows a problem again, besides the list above the form: under the options, on the true/false key —
 * or nowhere else (`form`) when no field of this type can fix it.
 */
export type ProblemPlace = 'options' | 'answer' | 'form'

const OPTIONS_PROBLEMS: ReadonlySet<QuestionProblem> = new Set(['options_too_many', 'multiple_correct_options', 'duplicate_options', 'options_too_few', 'correct_option_required'])

export function problemPlaceOf(type: QuestionType, problem: QuestionProblem): ProblemPlace {
  if (type === 'single_choice') return OPTIONS_PROBLEMS.has(problem) ? 'options' : 'form'
  return problem === 'correct_answer_required' ? 'answer' : 'form'
}

/** The problems of one place, in the order given (the server's catalogue order). */
export function problemsAt(type: QuestionType, problems: readonly QuestionProblem[], place: ProblemPlace): QuestionProblem[] {
  return problems.filter((problem) => problemPlaceOf(type, problem) === place)
}

const isNumber = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)

/** The body of API-266 for a question saved as `status`. */
export function buildCreateQuestionInput(values: QuestionFormValues, status: QuestionCreateStatus): CreateQuestionInput {
  const input: CreateQuestionInput = {
    type: values.type,
    prompt: localizedOf(values.promptAr, values.promptEn) ?? { ar: text(values.promptAr) },
    // The form requires the points; the default only satisfies the type checker.
    points: isNumber(values.points) ? values.points : DEFAULT_QUESTION_POINTS,
    status,
  }
  const explanation = localizedOf(values.explanationAr, values.explanationEn)
  if (explanation) input.explanation = explanation
  if (values.difficulty && values.difficulty !== NO_DIFFICULTY) input.difficulty = values.difficulty
  const tags = normalizeTags(values.tags ?? [])
  if (tags.length > 0) input.tags = tags
  if (values.type === 'single_choice') {
    // The whole ordered list, each option with its key as a JSON boolean.
    const options: QuestionOptionInput[] = optionsOf(values.options)
    if (options.length > 0) input.options = options
  } else if (typeof values.correctAnswer === 'boolean') {
    input.correctAnswer = values.correctAnswer
  }
  return input
}

/** Normalised values of a new question's form, for telling it from its untouched start (the type alone is a choice, not work). */
function workOf(values: Partial<QuestionFormValues>): string {
  return JSON.stringify({
    promptAr: text(values.promptAr),
    promptEn: text(values.promptEn),
    explanationAr: text(values.explanationAr),
    explanationEn: text(values.explanationEn),
    points: values.points ?? null,
    difficulty: values.difficulty ?? NO_DIFFICULTY,
    tags: normalizeTags(values.tags ?? []),
    options: (values.options ?? []).filter((row) => !isBlankOption(row)).map((row) => [text(row?.textAr), text(row?.textEn), row?.isCorrect === true]),
    correctAnswer: values.correctAnswer ?? null,
  })
}

/** True while the form of a NEW question holds something a close would lose. */
export function newQuestionHasWork(values: Partial<QuestionFormValues>): boolean {
  return workOf(values) !== workOf(newQuestionForm())
}
