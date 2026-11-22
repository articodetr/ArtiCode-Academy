// Pure rules of the online side of an exam (MOD-09 phase 2 — roadmap §4r;
// decisions D-R150..D-R159), unit-tested in exams.online.spec.ts. Nothing here
// touches the manual exams of the first phase: every function is called for an
// exam only when its settings or its delivery are at stake.
//
//   - D-R150: `delivery` is `manual` or `online` and changes in a draft only.
//     A manual exam carries no online setting — `closesAt` null, one attempt,
//     results on publish, no revealed answers (CHECK `ck_exams_manual_settings`
//     is the backstop). Turning an online draft back into a manual exam resets
//     them and drops its linked questions.
//   - D-R151: no new status. `scheduled` = the learners see the exam and, when
//     it is online, take it inside its window; `published` = its results are
//     released.
//   - D-R152: the window is `scheduledAt` (opens) .. `closesAt` (closes) and
//     `durationMinutes` is the time limit of one attempt.
//   - D-R158/D-R159: `schedule` needs at least one linked question, every one
//     of them `ready`, points that sum to `maxScore` exactly, the whole window
//     and the time limit; it then freezes a full copy of each question, from
//     which the attempts are served and graded.
//   - Once the learners see the exam its `maxScore` is frozen with its
//     questions; once somebody has started, the opening, the time limit and the
//     attempt count cannot shrink the conditions they started under: the
//     window only moves later and the attempts only rise.
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ExamStatus } from '../generated/prisma/client.js';
import type { QuestionStatusValue, QuestionTypeValue } from '../questions/questions.rules.js';

export const EXAM_DELIVERIES = ['manual', 'online'] as const;
export type ExamDeliveryValue = (typeof EXAM_DELIVERIES)[number];

export const EXAM_RESULTS_RELEASES = ['on_publish', 'on_submit'] as const;
export type ExamResultsReleaseValue = (typeof EXAM_RESULTS_RELEASES)[number];

/** CHECK `ck_exams_attempts_allowed_range`. */
export const EXAM_ATTEMPTS_MAX = 20;
/** The most questions one exam links (API-271). */
export const EXAM_QUESTIONS_MAX = 200;

export interface OnlineValues {
  delivery: ExamDeliveryValue;
  /** ISO 8601 in UTC with milliseconds, or null. */
  closesAt: string | null;
  attemptsAllowed: number;
  resultsRelease: ExamResultsReleaseValue;
  revealAnswers: boolean;
}

export const ONLINE_FIELDS = ['delivery', 'closesAt', 'attemptsAllowed', 'resultsRelease', 'revealAnswers'] as const;
export type OnlineField = (typeof ONLINE_FIELDS)[number];
export type OnlinePatch = Partial<OnlineValues>;

/** The settings every manual exam carries (the column defaults). */
export const MANUAL_SETTINGS: Omit<OnlineValues, 'delivery'> = { closesAt: null, attemptsAllowed: 1, resultsRelease: 'on_publish', revealAnswers: false };

/** True when the body carries none of the online fields. */
export function isEmptyOnlinePatch(patch: Partial<Record<OnlineField, unknown>>): boolean {
  return ONLINE_FIELDS.every((field) => patch[field] === undefined);
}

/**
 * The online values the exam would carry after the patch. Turning an exam
 * manual resets the four settings whatever the patch says about them — the
 * caller refuses a patch that names them first (`onlineFieldsOnManual()`).
 */
export function mergeOnline(current: OnlineValues, patch: OnlinePatch): OnlineValues {
  const merged: OnlineValues = { ...current };
  for (const field of ONLINE_FIELDS) {
    const requested = patch[field];
    if (requested !== undefined) (merged as unknown as Record<string, unknown>)[field] = requested;
  }
  return merged.delivery === 'manual' ? { delivery: 'manual', ...MANUAL_SETTINGS } : merged;
}

/** The online-only fields a patch names with a non-default value for an exam that is (or becomes) manual. */
export function onlineFieldsOnManual(resultingDelivery: ExamDeliveryValue, patch: OnlinePatch): OnlineField[] {
  if (resultingDelivery !== 'manual') return [];
  return (['closesAt', 'attemptsAllowed', 'resultsRelease', 'revealAnswers'] as const).filter((field) => patch[field] !== undefined && patch[field] !== MANUAL_SETTINGS[field]);
}

/** The fields whose value differs between the stored settings and the merged ones, in catalogue order. */
export function changedOnlineFields(current: OnlineValues, next: OnlineValues): OnlineField[] {
  return ONLINE_FIELDS.filter((field) => current[field] !== next[field]);
}

/** True when the window would close at or before it opens (CHECK `ck_exams_closes_after_opens` is the backstop). */
export function isWindowInverted(scheduledAt: string | null, closesAt: string | null): boolean {
  return scheduledAt !== null && closesAt !== null && Date.parse(closesAt) <= Date.parse(scheduledAt);
}

// ---------------------------------------------------------------------------
// Locks (API-116)
// ---------------------------------------------------------------------------

export interface OnlineLockState {
  status: ExamStatus;
  /** The delivery stored now. */
  delivery: ExamDeliveryValue;
  /** Attempts of any status. */
  attemptCount: number;
}

export interface OnlineLockValues {
  scheduledAt: string | null;
  closesAt: string | null;
  durationMinutes: number | null;
  attemptsAllowed: number;
}

/** The fields the lock rules look at; `undefined` = the request leaves the field alone. */
export interface OnlineLockRequest {
  delivery?: ExamDeliveryValue;
  maxScore?: string;
  scheduledAt?: string | null;
  closesAt?: string | null;
  durationMinutes?: number | null;
  attemptsAllowed?: number;
}

/**
 * Which of the changing fields an exam refuses for its online side:
 *   - `delivery` outside a draft;
 *   - for an online exam the learners can see (scheduled or published):
 *     `maxScore` (frozen with the questions' points) and clearing the opening,
 *     the closing or the time limit;
 *   - once an attempt exists: the opening, the time limit, fewer attempts and
 *     an earlier closing.
 * A manual exam is refused nothing here (its own rule locks `maxScore` once a
 * result exists).
 */
export function lockedOnlineFields(state: OnlineLockState, current: OnlineLockValues, changes: OnlineLockRequest): string[] {
  // A change of delivery outside a draft is the whole refusal: the settings it would reset are a consequence, not a request.
  if (changes.delivery !== undefined && state.status !== 'draft') return ['delivery'];
  const locked = new Set<string>();
  if (state.delivery === 'online' && state.status !== 'draft') {
    if (changes.maxScore !== undefined) locked.add('maxScore');
    if (changes.scheduledAt === null) locked.add('scheduledAt');
    if (changes.closesAt === null) locked.add('closesAt');
    if (changes.durationMinutes === null) locked.add('durationMinutes');
  }
  if (state.delivery === 'online' && state.attemptCount > 0) {
    if (changes.scheduledAt !== undefined) locked.add('scheduledAt');
    if (changes.durationMinutes !== undefined) locked.add('durationMinutes');
    if (changes.attemptsAllowed !== undefined && changes.attemptsAllowed < current.attemptsAllowed) locked.add('attemptsAllowed');
    if (typeof changes.closesAt === 'string' && current.closesAt !== null && Date.parse(changes.closesAt) < Date.parse(current.closesAt)) locked.add('closesAt');
  }
  const order = ['delivery', 'scheduledAt', 'closesAt', 'durationMinutes', 'maxScore', 'attemptsAllowed'];
  return order.filter((field) => locked.has(field));
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

export type ExamWindowState = 'not_open' | 'open' | 'closed';

/** Where `now` falls in the window; an exam without a whole window is `not_open` (only a draft lacks one). */
export function windowStateOf(scheduledAt: Date | null, closesAt: Date | null, now: Date): ExamWindowState {
  if (scheduledAt === null || closesAt === null) return 'not_open';
  if (now.getTime() < scheduledAt.getTime()) return 'not_open';
  return now.getTime() < closesAt.getTime() ? 'open' : 'closed';
}

// ---------------------------------------------------------------------------
// Readiness (API-117 `schedule`) and the question set (API-271)
// ---------------------------------------------------------------------------

export const EXAM_READINESS_PROBLEMS = ['no_questions', 'questions_not_ready', 'points_mismatch', 'window_missing', 'duration_missing', 'window_closed'] as const;
export type ExamReadinessProblem = (typeof EXAM_READINESS_PROBLEMS)[number];

export interface LinkedQuestionState {
  questionId: string;
  status: QuestionStatusValue;
  /** `numeric(6,2)` text. */
  points: string;
}

export interface ExamReadiness {
  problems: ExamReadinessProblem[];
  /** `numeric` text with two decimals. */
  totalPoints: string;
  /** The linked questions that are not `ready`. */
  notReady: string[];
}

/** The sum of `numeric(6,2)` texts as a two-decimal text — decimal arithmetic, never floats. */
export function sumPoints(points: readonly string[]): string {
  return points.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).toFixed(2);
}

/** What keeps an online exam from being made available now (D-R159), in catalogue order. */
export function examReadiness(input: {
  scheduledAt: Date | null;
  closesAt: Date | null;
  durationMinutes: number | null;
  /** `numeric(6,2)` text. */
  maxScore: string;
  questions: readonly LinkedQuestionState[];
  now: Date;
}): ExamReadiness {
  const problems = new Set<ExamReadinessProblem>();
  const totalPoints = sumPoints(input.questions.map((question) => question.points));
  const notReady = input.questions.filter((question) => question.status !== 'ready').map((question) => question.questionId);
  if (input.questions.length === 0) problems.add('no_questions');
  if (notReady.length > 0) problems.add('questions_not_ready');
  if (input.questions.length > 0 && !new Prisma.Decimal(totalPoints).equals(input.maxScore)) problems.add('points_mismatch');
  if (input.scheduledAt === null || input.closesAt === null) problems.add('window_missing');
  else if (input.now.getTime() >= input.closesAt.getTime()) problems.add('window_closed');
  if (input.durationMinutes === null) problems.add('duration_missing');
  return { problems: EXAM_READINESS_PROBLEMS.filter((problem) => problems.has(problem)), totalPoints, notReady };
}

export interface ExamQuestionEntry {
  questionId: string;
  /** `numeric(6,2)` text. */
  points: string;
}

export interface ExamQuestionsPlan {
  changed: boolean;
  added: string[];
  removed: string[];
  /** Kept questions whose points differ. */
  repointed: string[];
  /** True when the kept questions come in another order. */
  reordered: boolean;
}

/** Question ids named more than once (each once, in first-seen order). */
export function duplicateQuestionIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

/** Compares the stored ordered set with the requested one (the request is the whole new list). */
export function planExamQuestions(current: readonly ExamQuestionEntry[], requested: readonly ExamQuestionEntry[]): ExamQuestionsPlan {
  const before = new Map(current.map((entry) => [entry.questionId, entry.points]));
  const after = new Map(requested.map((entry) => [entry.questionId, entry.points]));
  const added = requested.filter((entry) => !before.has(entry.questionId)).map((entry) => entry.questionId);
  const removed = current.filter((entry) => !after.has(entry.questionId)).map((entry) => entry.questionId);
  const repointed = requested.filter((entry) => before.has(entry.questionId) && before.get(entry.questionId) !== entry.points).map((entry) => entry.questionId);
  const keptBefore = current.filter((entry) => after.has(entry.questionId)).map((entry) => entry.questionId);
  const keptAfter = requested.filter((entry) => before.has(entry.questionId)).map((entry) => entry.questionId);
  const reordered = keptBefore.some((questionId, index) => questionId !== keptAfter[index]);
  return { changed: added.length > 0 || removed.length > 0 || repointed.length > 0 || reordered, added, removed, repointed, reordered };
}

// ---------------------------------------------------------------------------
// The frozen copy (D-R158)
// ---------------------------------------------------------------------------

export interface SnapshotOption {
  id: string;
  text: LocalizedText;
  isCorrect: boolean;
}

/** What `exam_questions.snapshot` holds once the exam is scheduled. */
export interface QuestionSnapshot {
  type: QuestionTypeValue;
  prompt: LocalizedText;
  explanation: LocalizedText | null;
  /** In display order; empty for a `true_false` question. */
  options: SnapshotOption[];
  /** The key of a `true_false` question; null for `single_choice`. */
  correctBoolean: boolean | null;
}

/** The bank question as the snapshot builder reads it. */
export interface SnapshotSource {
  type: QuestionTypeValue;
  prompt: unknown;
  explanation: unknown;
  correctBoolean: boolean | null;
  options: readonly { id: string; text: unknown; isCorrect: boolean }[];
}

/** The full copy of a bank question an exam keeps from `schedule` on. */
export function buildSnapshot(question: SnapshotSource): QuestionSnapshot {
  return {
    type: question.type,
    prompt: readLocalizedText(question.prompt) ?? { ar: '' },
    explanation: readLocalizedText(question.explanation),
    options: question.options.map((option) => ({ id: option.id, text: readLocalizedText(option.text) ?? { ar: '' }, isCorrect: option.isCorrect })),
    correctBoolean: question.type === 'true_false' ? question.correctBoolean : null,
  };
}

/** Reads a stored snapshot; anything that is not one (the CHECK makes that impossible) is null. */
export function readSnapshot(value: unknown): QuestionSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record['type'] !== 'single_choice' && record['type'] !== 'true_false') return null;
  const prompt = readLocalizedText(record['prompt']);
  if (prompt === null || !Array.isArray(record['options'])) return null;
  const options: SnapshotOption[] = [];
  for (const raw of record['options'] as unknown[]) {
    if (!raw || typeof raw !== 'object') return null;
    const option = raw as Record<string, unknown>;
    const text = readLocalizedText(option['text']);
    if (typeof option['id'] !== 'string' || text === null || typeof option['isCorrect'] !== 'boolean') return null;
    options.push({ id: option['id'], text, isCorrect: option['isCorrect'] });
  }
  const correctBoolean = typeof record['correctBoolean'] === 'boolean' ? record['correctBoolean'] : null;
  return { type: record['type'], prompt, explanation: readLocalizedText(record['explanation']), options, correctBoolean };
}
