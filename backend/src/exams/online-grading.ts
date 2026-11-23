// The auto-grading engine of MOD-09 phase 2 (roadmap §4r; decisions D-R153,
// D-R159, D-R163) as pure functions, unit-tested in online-grading.spec.ts.
// It runs on the server only, from the frozen copy of each question
// (`exam_questions.snapshot` — D-R158): the browser never sees a key before
// the release rules allow it and never computes a score.
//
//   - A response is typed JSON: `{ optionId }` for `single_choice`, `{ value }`
//     for `true_false`. Anything else is malformed for that question — refused
//     when it is saved, and worth nothing if it ever reached a grading.
//   - A correct answer earns the question's points in full; a wrong one and a
//     question left unanswered earn 0. No negative marks, no partial credit.
//   - Points are `numeric(6,2)` texts added as decimals (never floats); the
//     total is capped at the attempt's maximum score.
//   - With several attempts the counted result is the highest score among the
//     finished ones; on a tie the earliest attempt counts (D-R153).
import { Prisma } from '../generated/prisma/client.js';
import type { QuestionSnapshot } from './exams.online.js';

export type AnswerResponse = { optionId: string } | { value: boolean };

/** Why a response does not fit its question. */
export type ResponseProblem = 'not_an_object' | 'option_required' | 'option_unknown' | 'value_required' | 'unexpected_field';

export type ParsedResponse = { ok: true; response: AnswerResponse } | { ok: false; problem: ResponseProblem };

/** Checks a response against the frozen question it answers. */
export function parseResponse(snapshot: QuestionSnapshot, raw: unknown): ParsedResponse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, problem: 'not_an_object' };
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);
  if (snapshot.type === 'single_choice') {
    if (keys.some((key) => key !== 'optionId')) return { ok: false, problem: 'unexpected_field' };
    if (typeof record['optionId'] !== 'string') return { ok: false, problem: 'option_required' };
    if (!snapshot.options.some((option) => option.id === record['optionId'])) return { ok: false, problem: 'option_unknown' };
    return { ok: true, response: { optionId: record['optionId'] } };
  }
  if (keys.some((key) => key !== 'value')) return { ok: false, problem: 'unexpected_field' };
  if (typeof record['value'] !== 'boolean') return { ok: false, problem: 'value_required' };
  return { ok: true, response: { value: record['value'] } };
}

/** True when the response is the question's key. */
export function isCorrectResponse(snapshot: QuestionSnapshot, response: AnswerResponse): boolean {
  if (snapshot.type === 'single_choice') {
    if (!('optionId' in response)) return false;
    const chosen = snapshot.options.find((option) => option.id === response.optionId);
    return chosen !== undefined && chosen.isCorrect;
  }
  return 'value' in response && snapshot.correctBoolean !== null && response.value === snapshot.correctBoolean;
}

export interface GradableQuestion {
  /** The id of the `exam_questions` link — what an answer names. */
  id: string;
  /** `numeric(6,2)` text. */
  points: string;
  snapshot: QuestionSnapshot;
}

export interface GradedAnswer {
  examQuestionId: string;
  isCorrect: boolean;
  /** `numeric(6,2)` text. */
  pointsAwarded: string;
}

export interface AttemptGrade {
  /** `numeric(6,2)` text, within 0..maxScore. */
  score: string;
  correctCount: number;
  /** One entry per ANSWERED question, in the exam's order; an unanswered question has none (and earns 0). */
  answers: GradedAnswer[];
}

/**
 * Grades one attempt: `responses` maps the id of an exam question to the
 * stored response. A response that does not fit its question is wrong.
 */
export function gradeAttempt(questions: readonly GradableQuestion[], responses: ReadonlyMap<string, unknown>, maxScore: string): AttemptGrade {
  let total = new Prisma.Decimal(0);
  let correctCount = 0;
  const answers: GradedAnswer[] = [];
  for (const question of questions) {
    if (!responses.has(question.id)) continue;
    const parsed = parseResponse(question.snapshot, responses.get(question.id));
    const correct = parsed.ok && isCorrectResponse(question.snapshot, parsed.response);
    const awarded = correct ? new Prisma.Decimal(question.points) : new Prisma.Decimal(0);
    if (correct) correctCount += 1;
    total = total.plus(awarded);
    answers.push({ examQuestionId: question.id, isCorrect: correct, pointsAwarded: awarded.toFixed(2) });
  }
  const cap = new Prisma.Decimal(maxScore);
  return { score: (total.greaterThan(cap) ? cap : total).toFixed(2), correctCount, answers };
}

export interface FinishedAttemptScore {
  attemptNo: number;
  /** `numeric(6,2)` text. */
  score: string;
}

/** The attempt that counts (D-R153): the highest score; on a tie the earliest attempt. Null without a finished attempt. */
export function countedAttempt<T extends FinishedAttemptScore>(attempts: readonly T[]): T | null {
  let best: T | null = null;
  for (const attempt of attempts) {
    if (best === null) {
      best = attempt;
      continue;
    }
    const comparison = new Prisma.Decimal(attempt.score).comparedTo(best.score);
    if (comparison > 0 || (comparison === 0 && attempt.attemptNo < best.attemptNo)) best = attempt;
  }
  return best;
}

/** True when the score reaches the pass score; null when the exam names none (D-R42: informational). */
export function passOutcome(score: string, passScore: string | null): boolean | null {
  return passScore === null ? null : new Prisma.Decimal(score).greaterThanOrEqualTo(passScore);
}
