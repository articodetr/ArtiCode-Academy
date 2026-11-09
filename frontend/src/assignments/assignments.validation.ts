// Local mirrors of the rules of CreateAssignmentDto / UpdateAssignmentDto
// (backend/src/assignments/assignments.dto.ts) and of the late policy of
// assignments.changes.ts (J-F38). The form words every refusal itself; the
// server stays the boundary. Pure; unit-tested in assignments.validation.test.ts.
import { ASSIGNMENT_DECIMAL_PLACES, LATE_PENALTY_LIMIT, MAX_ATTEMPTS_LIMIT, MAX_SCORE_LIMIT, MAX_SCORE_MIN, WEIGHT_LIMIT } from '../api/assignments'

/** A finite JSON number with at most two decimals — class-validator's `IsNumber({ maxDecimalPlaces: 2 })`. */
export function isTwoDecimalNumber(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (value % 1 === 0) return true
  return (String(value).split('.')[1] ?? '').length <= ASSIGNMENT_DECIMAL_PLACES
}

const blank = (value: unknown) => value === null || value === undefined

/** `maxScore`: required, 0.01..9999.99 with at most two decimals. */
export function isMaxScoreValid(value: unknown): boolean {
  return isTwoDecimalNumber(value) && value >= MAX_SCORE_MIN && value <= MAX_SCORE_LIMIT
}

/** `weight`: optional, 0..999.99 with at most two decimals. */
export function isWeightValid(value: unknown): boolean {
  return blank(value) || (isTwoDecimalNumber(value) && value >= 0 && value <= WEIGHT_LIMIT)
}

/** `latePenaltyPercent`: optional, 0..100 with at most two decimals. */
export function isLatePenaltyValid(value: unknown): boolean {
  return blank(value) || (isTwoDecimalNumber(value) && value >= 0 && value <= LATE_PENALTY_LIMIT)
}

/** `maxAttempts`: an integer 1..20. */
export function isMaxAttemptsValid(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ATTEMPTS_LIMIT
}

/** A late penalty without `allowLate` — the server's `late_penalty_invalid` (a penalty of 0 included, as the CHECK). */
export function latePenaltyWithoutAllowLate(allowLate: boolean | undefined, latePenaltyPercent: number | null | undefined): boolean {
  return !blank(latePenaltyPercent) && !allowLate
}

/** Which half of the due date is missing when the other is filled in; null when both or neither are. */
export function missingDuePart(date: string | undefined, time: string | undefined): 'date' | 'time' | null {
  if (date && !time) return 'time'
  if (time && !date) return 'date'
  return null
}
