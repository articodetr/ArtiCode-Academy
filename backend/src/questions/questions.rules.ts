// Pure rules of the question banks (MOD-09 phase 2 — roadmap §4r; decisions
// D-R163/D-R164), unit-tested in questions.rules.spec.ts. No framework and no
// Prisma import: the exam side (exams/exams.online.ts) reads the same types to
// freeze a question into an exam.
//
//   - Two auto-graded types (D-R163). A `single_choice` question carries 2..10
//     options with exactly one correct and no boolean key; a `true_false`
//     question carries no options and its key in `correctAnswer`.
//   - Three statuses (D-R164). A `draft` may be incomplete — it only has to be
//     well-formed (nothing that belongs to the other type, at most one correct
//     option, no two options with the same Arabic text); a `ready` question
//     also passes the completeness rules of its type; an `archived` question
//     keeps whatever it had.
//   - A PATCH is a smallest diff: only the fields that really change are
//     written, and the options are compared as a whole ordered list.
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';

export const QUESTION_TYPES = ['single_choice', 'true_false'] as const;
export type QuestionTypeValue = (typeof QUESTION_TYPES)[number];

export const QUESTION_STATUSES = ['draft', 'ready', 'archived'] as const;
export type QuestionStatusValue = (typeof QUESTION_STATUSES)[number];

export const QUESTION_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type QuestionDifficultyValue = (typeof QUESTION_DIFFICULTIES)[number];

/** Characters per locale of a prompt and of an explanation. */
export const QUESTION_TEXT_MAX_LENGTH = 2000;
/** Characters per locale of one option. */
export const OPTION_TEXT_MAX_LENGTH = 500;
export const QUESTION_OPTIONS_MIN = 2;
export const QUESTION_OPTIONS_MAX = 10;
/** CHECK `ck_questions_tags_limit`. */
export const QUESTION_TAGS_MAX = 10;
export const QUESTION_TAG_MAX_LENGTH = 40;
/** `numeric(6,2)`. */
export const QUESTION_POINTS_LIMIT = 9999.99;

export interface OptionContent {
  text: LocalizedText;
  isCorrect: boolean;
}

/** What the rules look at: the type, the status the question would have, and its key. */
export interface QuestionContent {
  type: QuestionTypeValue;
  status: QuestionStatusValue;
  options: readonly OptionContent[];
  /** The key of a `true_false` question; null for a draft that has none yet and for any other type. */
  correctAnswer: boolean | null;
}

export const QUESTION_PROBLEMS = [
  'options_not_allowed',
  'correct_answer_not_allowed',
  'options_too_many',
  'multiple_correct_options',
  'duplicate_options',
  'options_too_few',
  'correct_option_required',
  'correct_answer_required',
] as const;
export type QuestionProblem = (typeof QUESTION_PROBLEMS)[number];

function comparable(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar');
}

/** True when two options show the same Arabic text (trimmed, single-spaced, case-insensitive). */
export function hasDuplicateOptions(options: readonly OptionContent[]): boolean {
  const seen = new Set<string>();
  for (const option of options) {
    const key = comparable(option.text.ar);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

/**
 * The rules the content breaks, in catalogue order; an empty list = valid.
 * Well-formedness applies in every status, completeness only to `ready`.
 */
export function questionProblems(content: QuestionContent): QuestionProblem[] {
  const problems = new Set<QuestionProblem>();
  const correct = content.options.filter((option) => option.isCorrect).length;
  if (content.type === 'true_false') {
    if (content.options.length > 0) problems.add('options_not_allowed');
    if (content.status === 'ready' && content.correctAnswer === null) problems.add('correct_answer_required');
  } else {
    if (content.correctAnswer !== null) problems.add('correct_answer_not_allowed');
    if (content.options.length > QUESTION_OPTIONS_MAX) problems.add('options_too_many');
    if (correct > 1) problems.add('multiple_correct_options');
    if (hasDuplicateOptions(content.options)) problems.add('duplicate_options');
    if (content.status === 'ready') {
      if (content.options.length < QUESTION_OPTIONS_MIN) problems.add('options_too_few');
      if (correct === 0) problems.add('correct_option_required');
    }
  }
  return QUESTION_PROBLEMS.filter((problem) => problems.has(problem));
}

/** Trimmed, single-spaced, lower-cased tags without blanks or repeats, in first-seen order. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ').toLowerCase();
    if (tag === '' || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

/** `numeric(6,2)` text of a JSON number (two decimals, half up as PostgreSQL rounds a numeric literal). */
export function pointsText(value: number): string {
  return value.toFixed(2);
}

// ---------------------------------------------------------------------------
// PATCH planning
// ---------------------------------------------------------------------------

export interface QuestionValues {
  status: QuestionStatusValue;
  prompt: LocalizedText;
  explanation: LocalizedText | null;
  /** `numeric(6,2)` text. */
  points: string;
  difficulty: QuestionDifficultyValue | null;
  tags: string[];
  options: OptionContent[];
  correctAnswer: boolean | null;
}

export const QUESTION_FIELDS = ['status', 'prompt', 'explanation', 'points', 'difficulty', 'tags', 'options', 'correctAnswer'] as const;
export type QuestionField = (typeof QUESTION_FIELDS)[number];
export type QuestionPatch = Partial<QuestionValues>;

export interface QuestionUpdatePlan {
  /** Only the fields whose value differs from the stored one. */
  data: QuestionPatch;
  /** Their names, in catalogue order (the `fields` of the audit event). */
  fields: QuestionField[];
  /** The question as it would be after the write. */
  next: QuestionValues;
}

/** Options are equal when they are the same texts with the same key, in the same order. */
export function sameOptions(a: readonly OptionContent[], b: readonly OptionContent[]): boolean {
  return a.length === b.length && a.every((option, index) => option.isCorrect === b[index]!.isCorrect && sameLocalizedText(option.text, b[index]!.text));
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

/** The smallest write that takes `current` to the requested values; nothing differs = an empty plan. */
export function planQuestionUpdate(current: QuestionValues, patch: QuestionPatch): QuestionUpdatePlan {
  const data: QuestionPatch = {};
  if (patch.status !== undefined && patch.status !== current.status) data.status = patch.status;
  if (patch.prompt !== undefined && !sameLocalizedText(patch.prompt, current.prompt)) data.prompt = patch.prompt;
  if (patch.explanation !== undefined && !sameLocalizedText(patch.explanation, current.explanation)) data.explanation = patch.explanation;
  if (patch.points !== undefined && patch.points !== current.points) data.points = patch.points;
  if (patch.difficulty !== undefined && patch.difficulty !== current.difficulty) data.difficulty = patch.difficulty;
  if (patch.tags !== undefined && !sameTags(patch.tags, current.tags)) data.tags = patch.tags;
  if (patch.options !== undefined && !sameOptions(patch.options, current.options)) data.options = patch.options;
  if (patch.correctAnswer !== undefined && patch.correctAnswer !== current.correctAnswer) data.correctAnswer = patch.correctAnswer;
  const fields = QUESTION_FIELDS.filter((field) => data[field] !== undefined);
  return { data, fields, next: { ...current, ...data } };
}

export interface BankValues {
  name: LocalizedText;
  description: LocalizedText | null;
  courseId: string | null;
}

export const BANK_FIELDS = ['name', 'description', 'courseId'] as const;
export type BankField = (typeof BANK_FIELDS)[number];
export type BankPatch = Partial<BankValues>;

/** The smallest write that takes a bank to the requested values. */
export function planBankUpdate(current: BankValues, patch: BankPatch): { data: BankPatch; fields: BankField[] } {
  const data: BankPatch = {};
  if (patch.name !== undefined && !sameLocalizedText(patch.name, current.name)) data.name = patch.name;
  if (patch.description !== undefined && !sameLocalizedText(patch.description, current.description)) data.description = patch.description;
  if (patch.courseId !== undefined && patch.courseId !== current.courseId) data.courseId = patch.courseId;
  return { data, fields: BANK_FIELDS.filter((field) => data[field] !== undefined) };
}
