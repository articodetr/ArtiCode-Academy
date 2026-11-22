// Local mirrors of the rules of CreateExamDto / UpdateExamDto
// (backend/src/exams/exams.dto.ts), of the pass-score rule of exams.changes.ts
// and of a result's score (exam-results.dto.ts + scoreAboveMax()) — J-F45. The
// forms word every refusal themselves; the server stays the boundary. Pure;
// unit-tested in exams.validation.test.ts. Since MOD-09 phase 2 also the two
// rules of an online exam's settings: the attempts allowed and the window
// (isWindowInverted() of backend/src/exams/exams.online.ts — keep in sync).
import { EXAM_ATTEMPTS_MAX, EXAM_DURATION_MAX, EXAM_MAX_SCORE_MIN, EXAM_SCORE_LIMIT, EXAM_WEIGHT_LIMIT } from '../api/exams'
import { isTwoDecimalNumber } from '../assignments/assignments.validation'

const blank = (value: unknown) => value === null || value === undefined

/** `maxScore`: required, 0.01..9999.99 with at most two decimals. */
export function isExamMaxScoreValid(value: unknown): boolean {
  return isTwoDecimalNumber(value) && value >= EXAM_MAX_SCORE_MIN && value <= EXAM_SCORE_LIMIT
}

/** `passScore`: optional, 0..9999.99 with at most two decimals (at most maxScore — passScoreAboveMax()). */
export function isPassScoreValid(value: unknown): boolean {
  return blank(value) || (isTwoDecimalNumber(value) && value >= 0 && value <= EXAM_SCORE_LIMIT)
}

/** The server's `pass_score_invalid`: a pass score above the maximum score (both known). */
export function passScoreAboveMax(passScore: number | null | undefined, maxScore: number | null | undefined): boolean {
  return typeof passScore === 'number' && typeof maxScore === 'number' && passScore > maxScore
}

/** `weight`: optional, 0..999.99 with at most two decimals. */
export function isExamWeightValid(value: unknown): boolean {
  return blank(value) || (isTwoDecimalNumber(value) && value >= 0 && value <= EXAM_WEIGHT_LIMIT)
}

/** `durationMinutes`: optional, a whole number 1..720. */
export function isDurationValid(value: unknown): boolean {
  return blank(value) || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= EXAM_DURATION_MAX)
}

/** A result's `score`: 0..maxScore with at most two decimals (`IsNumber({ maxDecimalPlaces: 2 })` + `score_out_of_range`). */
export function isResultScoreValid(value: unknown, maxScore: number): boolean {
  return isTwoDecimalNumber(value) && value >= 0 && value <= Math.min(maxScore, EXAM_SCORE_LIMIT)
}

/** Which half of the exam date is missing when the other is filled in; null when both or neither are. */
export function missingSchedulePart(date: string | undefined, time: string | undefined): 'date' | 'time' | null {
  if (date && !time) return 'time'
  if (time && !date) return 'date'
  return null
}

/** `attemptsAllowed` of an online exam: a whole number 1..20 (`EXAM_ATTEMPTS_MAX`); never blank. */
export function isAttemptsAllowedValid(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= EXAM_ATTEMPTS_MAX
}

/** The server's `window_invalid`: the window would close at or before it opens (both instants known). */
export function isWindowInverted(opensAt: string | null | undefined, closesAt: string | null | undefined): boolean {
  return typeof opensAt === 'string' && typeof closesAt === 'string' && Date.parse(closesAt) <= Date.parse(opensAt)
}
