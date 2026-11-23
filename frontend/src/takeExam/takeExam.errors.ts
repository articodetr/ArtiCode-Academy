// How taking an online exam reads a refusal of API-276..API-279 (MOD-09 phase
// 2): the learner's part of backend/src/grades/grades.errors.ts plus the
// auth/permission guards, each mapped to a worded message under
// `takeExam.errors` — and, for a save, to what the page does next.
// Unit-tested in takeExam.errors.test.ts.
//
//   start (API-276)   404 exam_not_found · 403 enrollment_required { enrollmentStatus } · 403 permission_denied ·
//                     409 exam_not_open { reason, opensAt, closesAt } · 409 attempts_exhausted { attemptsAllowed, attempts } ·
//                     409 class_closed · 409 attempt_conflict { expected, next } · 429 rate_limited
//   read (API-277)    404 attempt_not_found · 400 for an id that is not a uuid
//   save (API-278)    400 answers_invalid { unknown, duplicates, malformed } · 409 attempt_closed { status } ·
//                     404 attempt_not_found · 403 permission_denied · 429 rate_limited
//   submit (API-279)  404 attempt_not_found · 403 permission_denied · 429 rate_limited · 400 for ANY body field
//                     (it is sent without a body)
// The start takes `attemptNo` as a JSON integer or not at all — `null` is a 400 — so the client sends a number or
// omits the field.
import { ApiError } from '../api/client'
import { EXAM_NOT_OPEN_REASONS } from '../api/myAttempts'
import type { ExamNotOpenReason } from '../api/myAttempts'
import { failureMessage as usersFailureMessage } from '../users/users.errors'
import type { Translate } from '../users/users.format'
import type { UsersFailure } from '../users/users.errors'

export interface TakeFailure extends UsersFailure {
  /** The server's code, or null for a failure without one (the network, a 5xx, an unknown refusal). */
  code: string | null
  /** True for a refusal that repeating the same request cannot change: the state behind it moved on. */
  terminal: boolean
  /** An instant the refusal named (when the exam opens or closed): shown in the exam's zone by takeFailureMessage(). */
  instant?: string
  /** The enrollment status `enrollment_required` named. */
  enrollmentStatus?: string
  /** Seconds a 429 asked to wait, when it named them. */
  retryAfterSeconds?: number | null
}

/** Refusals of the start that no repeat of it can change — the list is read again instead. */
const TERMINAL_CODES = new Set(['exam_not_found', 'enrollment_required', 'exam_not_open', 'attempts_exhausted', 'class_closed', 'permission_denied', 'attempt_conflict', 'attempt_not_found', 'attempt_closed'])

/** Codes worded as `takeExam.errors.<code>` without a detail of their own. */
const PLAIN_CODES = new Set(['exam_not_found', 'class_closed', 'permission_denied', 'rate_limited', 'attempt_conflict', 'attempt_not_found', 'attempt_closed', 'answers_invalid', 'origin_forbidden'])

/** Enrollment statuses with a label (`labels.*`) — `active` is never refused. */
const ENROLLMENT_STATUSES = new Set(['pending', 'completed', 'withdrawn', 'cancelled'])

function bodyOf(error: ApiError): Record<string, unknown> {
  return (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
}

function instantOf(value: unknown): string | undefined {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined
}

function wholeNumber(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null
}

function isNotOpenReason(value: unknown): value is ExamNotOpenReason {
  return typeof value === 'string' && (EXAM_NOT_OPEN_REASONS as readonly string[]).includes(value)
}

export function describeTakeFailure(error: unknown): TakeFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network', code: null, terminal: false }
  const body = bodyOf(error)
  const code = error.code
  const terminal = code !== null && TERMINAL_CODES.has(code)

  if (code === 'exam_not_open') {
    // `results_published` names no instant worth showing; before the window the opening, after it the closing.
    const reason = isNotOpenReason(body.reason) ? body.reason : 'closed'
    if (reason === 'results_published') return { key: 'takeExam.errors.results_published', code, terminal }
    const instant = instantOf(reason === 'not_open_yet' ? body.opensAt : body.closesAt)
    return instant ? { key: `takeExam.errors.${reason}_at`, code, terminal, instant } : { key: `takeExam.errors.${reason}`, code, terminal }
  }
  if (code === 'enrollment_required') {
    const status = typeof body.enrollmentStatus === 'string' && ENROLLMENT_STATUSES.has(body.enrollmentStatus) ? body.enrollmentStatus : undefined
    return status
      ? { key: 'takeExam.errors.enrollment_required_status', code, terminal, enrollmentStatus: status }
      : { key: 'takeExam.errors.enrollment_required', code, terminal }
  }
  if (code === 'attempts_exhausted') {
    const attempts = wholeNumber(body.attempts)
    const allowed = wholeNumber(body.attemptsAllowed)
    return attempts !== null && allowed !== null
      ? { key: 'takeExam.errors.attempts_exhausted_count', code, terminal, params: { attempts, allowed } }
      : { key: 'takeExam.errors.attempts_exhausted', code, terminal }
  }
  if (code !== null && PLAIN_CODES.has(code)) {
    const failure: TakeFailure = { key: `takeExam.errors.${code}`, code, terminal }
    if (code === 'rate_limited') failure.retryAfterSeconds = error.retryAfterSeconds
    return failure
  }
  // A 429 without the code (a proxy in front of the API) is still «wait».
  if (error.status === 429) return { key: 'takeExam.errors.rate_limited', code, terminal: false, retryAfterSeconds: error.retryAfterSeconds }
  // The session is gone, or it now belongs to somebody else (KI-046): nothing is replayed.
  if (error.status === 401) return { key: 'takeExam.errors.session', code, terminal: false }
  if (error.status >= 500) return { key: 'login.errors.server', code, terminal: false }
  return { key: 'login.errors.generic', code, terminal: false }
}

/** True for the failure of one server code. */
export function isTakeFailure(failure: TakeFailure, code: string): boolean {
  return failure.code === code
}

/**
 * The failure's text. `formatInstant` shows an instant the refusal named in the exam's zone (the caller knows the
 * zone); without it the worded message carries no date.
 */
export function takeFailureMessage(t: Translate, failure: TakeFailure, formatInstant?: (iso: string) => string): string {
  if (failure.instant) {
    if (formatInstant) return usersFailureMessage(t, { ...failure, params: { ...failure.params, date: formatInstant(failure.instant) } })
    return usersFailureMessage(t, { ...failure, key: failure.key.replace(/_at$/, '') })
  }
  if (failure.enrollmentStatus) return usersFailureMessage(t, { ...failure, params: { ...failure.params, status: t(`labels.${failure.enrollmentStatus}`) } })
  return usersFailureMessage(t, failure)
}

/** True for the 404 of API-277..API-279: not this learner's attempt, or gone. */
export function isAttemptGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

/**
 * True for the 400 the FIRST read answers to an id no attempt can have (a mistyped or cut link — «uuid is expected»):
 * as good as not found. Only the first read: once an attempt was read, a 400 of its routes is a refused request
 * (the submit, for one, refuses any body field), never a missing attempt.
 */
export function isUnknownAttemptId(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400 && error.code === null
}

/**
 * What the page does after a failed save (API-278):
 * - `closed`: 409 attempt_closed — the attempt takes no more answers: stop saving, read it again, show it finished;
 * - `reset`: 400 answers_invalid — the screen and the server disagree about the questions: read the attempt again;
 * - `gone`: 404 — the attempt is not this learner's (any more);
 * - `retry`: the network, a timeout, a 5xx or a 429 — keep the answers and try again by itself after a pause;
 * - `hold`: any other refusal (no permission, no session) — keep the answers; trying again is the learner's call.
 */
export type SaveFailureNext = 'closed' | 'reset' | 'gone' | 'retry' | 'hold'

export interface SaveFailure extends TakeFailure {
  next: SaveFailureNext
}

export function describeSaveFailure(error: unknown): SaveFailure {
  const failure = describeTakeFailure(error)
  if (!(error instanceof ApiError)) return { ...failure, next: 'retry' }
  if (error.code === 'attempt_closed') return { ...failure, next: 'closed' }
  if (error.code === 'answers_invalid') return { ...failure, next: 'reset' }
  if (error.status === 404) return { ...failure, next: 'gone' }
  if (error.status === 429 || error.status >= 500) return { ...failure, next: 'retry' }
  return { ...failure, next: 'hold' }
}
