// The ordered question set of an online draft as the «الأسئلة» tab of the exam
// drawer edits it (MOD-09 phase 2 — API-270/API-271), on the pattern of
// examResults.changes.ts: the editor holds rows — the linked questions in
// display order, each with the points its field holds — starting from what the
// server answered; questions picked from a bank are appended with their own
// default points; a row moves up or down, loses its place or gets other points.
// The save is ONE PUT of the WHOLE ordered list, sent only when the list
// differs from the saved one (order, membership or points at two decimals) —
// planQuestionsSave() says `unchanged` otherwise. Every entry names its points,
// so the exam is saved with what its author saw.
//
// The running total is a sum of the editor's own inputs — never a grade — done
// in whole hundredths so that 0.1 + 0.2 is 0.3: the exam can be made available
// only once it equals `maxScore` (D-R159), and the server decides that. Pure;
// unit-tested in examQuestions.set.test.ts.
import { EXAM_QUESTIONS_MAX } from '../api/examQuestions'
import type { ExamQuestionEntry, ExamQuestionItem } from '../api/examQuestions'
import { QUESTION_POINTS_LIMIT, QUESTION_POINTS_MIN } from '../api/questionBanks'
import type { Question, QuestionStatus, QuestionType } from '../api/questionBanks'
import type { LocalizedLabel } from '../api/users'
import { isTwoDecimalNumber } from '../assignments/assignments.validation'

/** One row of the editor. */
export interface QuestionRow {
  /** The bank question — what an entry of API-271 names. */
  questionId: string
  /** The points as the field holds them: null once cleared. */
  points: number | null
  prompt: LocalizedLabel
  type: QuestionType
  bank: { id: string; name: LocalizedLabel }
  /** The bank question's status as last read: a linked question can go back to draft or be archived. */
  status: QuestionStatus | null
  /** Picked in this session: the server does not hold the link yet. */
  added: boolean
}

/** Why a row's points cannot be sent. */
export type RowProblem = 'points_required' | 'points_invalid'

/** The editor's rows for the set the server answered (API-270, or the answer of API-271). */
export function rowsOf(items: readonly ExamQuestionItem[]): QuestionRow[] {
  return items.map((item) => ({
    questionId: item.questionId,
    points: item.points,
    prompt: item.question.prompt,
    type: item.question.type,
    bank: item.bank,
    status: item.question.status,
    added: false,
  }))
}

/** How many more questions the set takes (`EXAM_QUESTIONS_MAX`). */
export function roomLeft(rows: readonly QuestionRow[]): number {
  return Math.max(0, EXAM_QUESTIONS_MAX - rows.length)
}

/**
 * The rows with the picked bank questions appended in the order given, each
 * with its own default points; a question the set already holds is skipped (no
 * question twice — `exam_questions_invalid`) and nothing goes past the limit.
 */
export function addQuestions(rows: readonly QuestionRow[], questions: readonly Question[], bank: { id: string; name: LocalizedLabel }): QuestionRow[] {
  const next = [...rows]
  const held = new Set(rows.map((row) => row.questionId))
  for (const question of questions) {
    if (next.length >= EXAM_QUESTIONS_MAX) break
    if (held.has(question.id)) continue
    held.add(question.id)
    next.push({ questionId: question.id, points: question.points, prompt: question.prompt, type: question.type, bank: { id: bank.id, name: bank.name }, status: question.status, added: true })
  }
  return next
}

/** The rows with one moved a place up (-1) or down (1); unchanged at either end or for an unknown row. */
export function moveRow(rows: readonly QuestionRow[], questionId: string, delta: -1 | 1): QuestionRow[] {
  const from = rows.findIndex((row) => row.questionId === questionId)
  const to = from + delta
  if (from < 0 || to < 0 || to >= rows.length) return [...rows]
  const next = [...rows]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

export function removeRow(rows: readonly QuestionRow[], questionId: string): QuestionRow[] {
  return rows.filter((row) => row.questionId !== questionId)
}

export function setRowPoints(rows: readonly QuestionRow[], questionId: string, points: number | null): QuestionRow[] {
  return rows.map((row) => (row.questionId === questionId ? { ...row, points } : row))
}

/** A question's points in an exam: 0.01..9999.99 with at most two decimals (`ExamQuestionEntryDto`). */
export function isRowPointsValid(points: unknown): points is number {
  return isTwoDecimalNumber(points) && points >= QUESTION_POINTS_MIN && points <= QUESTION_POINTS_LIMIT
}

export function rowProblemOf(row: Pick<QuestionRow, 'points'>): RowProblem | null {
  if (row.points === null) return 'points_required'
  return isRowPointsValid(row.points) ? null : 'points_invalid'
}

/** The rows whose points the save would refuse, by question. */
export function rowProblems(rows: readonly QuestionRow[]): Map<string, RowProblem> {
  const problems = new Map<string, RowProblem>()
  for (const row of rows) {
    const problem = rowProblemOf(row)
    if (problem) problems.set(row.questionId, problem)
  }
  return problems
}

/** True when the set holds more questions than an exam takes. */
export function isOverLimit(rows: readonly QuestionRow[]): boolean {
  return rows.length > EXAM_QUESTIONS_MAX
}

/** A two-decimal amount as whole hundredths (the points are `numeric(6,2)`). */
export function hundredths(value: number): number {
  return Math.round(value * 100)
}

/** The sum of the rows' points in whole hundredths; a cleared field adds nothing. */
export function totalHundredths(rows: readonly Pick<QuestionRow, 'points'>[]): number {
  return rows.reduce((sum, row) => (typeof row.points === 'number' && Number.isFinite(row.points) ? sum + hundredths(row.points) : sum), 0)
}

/** Whole hundredths as the number to show: 1050 → `10.5`, 1000 → `10`, 1005 → `10.05`. */
export function formatHundredths(total: number): string {
  return String(total / 100)
}

/** True when the rows' points add up to the exam's maximum score exactly (D-R159). */
export function totalMatchesMaxScore(rows: readonly Pick<QuestionRow, 'points'>[], maxScore: number): boolean {
  return totalHundredths(rows) === hundredths(maxScore)
}

const samePoints = (saved: number, typed: number | null) => typed !== null && hundredths(saved) === hundredths(typed)

/** Whether the rows differ from the saved set: another question, another order or other points (compared at two decimals). */
export function questionSetDiffers(saved: readonly ExamQuestionItem[], rows: readonly QuestionRow[]): boolean {
  if (saved.length !== rows.length) return true
  return saved.some((item, index) => {
    const row = rows[index]!
    return item.questionId !== row.questionId || !samePoints(item.points, row.points)
  })
}

/** What «حفظ الأسئلة» does with the rows as they stand. */
export type QuestionsSavePlan =
  /** The rows are the saved set: no request. */
  | { kind: 'unchanged' }
  /** Some rows hold points the server would refuse: nothing is sent until they are put right. */
  | { kind: 'invalid'; problems: Map<string, RowProblem> }
  /** More questions than an exam takes. */
  | { kind: 'too_many' }
  /** The body of API-271: the whole ordered list, every entry with its points. */
  | { kind: 'save'; questions: ExamQuestionEntry[] }

/**
 * Plans the one PUT of the set. An entry always names its points — a row
 * without valid points is never sent, so the server never fills in a default
 * the editor did not show.
 */
export function planQuestionsSave(saved: readonly ExamQuestionItem[], rows: readonly QuestionRow[]): QuestionsSavePlan {
  if (!questionSetDiffers(saved, rows)) return { kind: 'unchanged' }
  const problems = rowProblems(rows)
  if (problems.size > 0) return { kind: 'invalid', problems }
  if (isOverLimit(rows)) return { kind: 'too_many' }
  return { kind: 'save', questions: rows.flatMap((row) => (isRowPointsValid(row.points) ? [{ questionId: row.questionId, points: row.points }] : [])) }
}
