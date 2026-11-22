// MOD-09 phase 2 (OEX-T07) — every refusal of API-276..API-279 has a worded
// Arabic message, and a failed save says what the page does next.
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import type { Translate } from '../users/users.format'
import { describeSaveFailure, describeTakeFailure, isAttemptGone, isTakeFailure, isUnknownAttemptId, takeFailureMessage } from './takeExam.errors'

const t: Translate = (key, options) => i18n.t(key, options ?? {})
const errors = ar.takeExam.errors

function refusal(status: number, code: string | undefined, details: Record<string, unknown> = {}, retryAfterSeconds: number | null = null) {
  return new ApiError(status, 'refused', { statusCode: status, ...(code ? { code } : {}), message: 'refused', ...details }, retryAfterSeconds)
}

/** The worded message, with instants shown as `<iso>` so the test does not depend on a zone. */
const worded = (error: unknown) => takeFailureMessage(t, describeTakeFailure(error), (iso) => `<${iso}>`)

describe('describeTakeFailure / takeFailureMessage — the start of an attempt (API-276)', () => {
  it('words every refusal the start can answer', () => {
    expect(worded(refusal(404, 'exam_not_found'))).toBe(errors.exam_not_found)
    expect(worded(refusal(409, 'class_closed', { classId: 'c', status: 'cancelled' }))).toBe(errors.class_closed)
    expect(worded(refusal(403, 'permission_denied', { missing: ['exams.take'] }))).toBe(errors.permission_denied)
    expect(worded(refusal(429, 'rate_limited'))).toBe(errors.rate_limited)
    expect(worded(refusal(409, 'attempt_conflict', { expected: 1, next: 2 }))).toBe(errors.attempt_conflict)
    expect(worded(refusal(403, 'origin_forbidden'))).toBe(errors.origin_forbidden)
  })

  it('says when the exam opens or closed, in the words of each reason of exam_not_open', () => {
    const opensAt = '2026-11-20T07:00:00.000Z'
    const closesAt = '2026-11-20T09:00:00.000Z'
    expect(worded(refusal(409, 'exam_not_open', { reason: 'not_open_yet', opensAt, closesAt }))).toBe(i18n.t('takeExam.errors.not_open_yet_at', { date: `<${opensAt}>` }))
    expect(worded(refusal(409, 'exam_not_open', { reason: 'closed', opensAt, closesAt }))).toBe(i18n.t('takeExam.errors.closed_at', { date: `<${closesAt}>` }))
    expect(worded(refusal(409, 'exam_not_open', { reason: 'results_published', opensAt, closesAt }))).toBe(errors.results_published)
    // Without a usable instant, or without a formatter, the plain sentence.
    expect(worded(refusal(409, 'exam_not_open', { reason: 'not_open_yet', opensAt: null, closesAt: null }))).toBe(errors.not_open_yet)
    expect(worded(refusal(409, 'exam_not_open', { reason: 'closed', closesAt: 'soon' }))).toBe(errors.closed)
    expect(takeFailureMessage(t, describeTakeFailure(refusal(409, 'exam_not_open', { reason: 'closed', closesAt })))).toBe(errors.closed)
    // An unknown reason is still «not open».
    expect(worded(refusal(409, 'exam_not_open', { reason: 'paused' }))).toBe(errors.closed)
  })

  it('names the enrollment status that keeps the learner out, when the server names one it knows', () => {
    expect(worded(refusal(403, 'enrollment_required', { enrollmentStatus: 'withdrawn' }))).toBe(i18n.t('takeExam.errors.enrollment_required_status', { status: ar.labels.withdrawn }))
    expect(worded(refusal(403, 'enrollment_required', { enrollmentStatus: 'completed' }))).toContain(ar.labels.completed)
    expect(worded(refusal(403, 'enrollment_required', { enrollmentStatus: null }))).toBe(errors.enrollment_required)
    expect(worded(refusal(403, 'enrollment_required', { enrollmentStatus: 'on_hold' }))).toBe(errors.enrollment_required)
  })

  it('counts the attempts used when the server sends both numbers', () => {
    expect(worded(refusal(409, 'attempts_exhausted', { attemptsAllowed: 2, attempts: 2 }))).toBe(i18n.t('takeExam.errors.attempts_exhausted_count', { attempts: '2', allowed: '2' }))
    expect(worded(refusal(409, 'attempts_exhausted'))).toBe(errors.attempts_exhausted)
  })

  it('marks as terminal what a second try cannot change — and the conflict, which means «read the list again»', () => {
    for (const [status, code] of [
      [404, 'exam_not_found'],
      [403, 'enrollment_required'],
      [409, 'exam_not_open'],
      [409, 'attempts_exhausted'],
      [409, 'class_closed'],
      [403, 'permission_denied'],
      [409, 'attempt_conflict'],
    ] as const) {
      const failure = describeTakeFailure(refusal(status, code))
      expect(failure.terminal, code).toBe(true)
      expect(isTakeFailure(failure, code)).toBe(true)
    }
    for (const error of [refusal(429, 'rate_limited'), refusal(500, undefined), new TypeError('Failed to fetch')]) expect(describeTakeFailure(error).terminal).toBe(false)
  })

  it('falls back to the shared messages for what has no code: the network, a 5xx, a lost session, anything else', () => {
    expect(worded(new TypeError('Failed to fetch'))).toBe(ar.login.errors.network)
    expect(worded(refusal(503, undefined))).toBe(ar.login.errors.server)
    expect(worded(refusal(401, 'token_expired'))).toBe(errors.session)
    expect(worded(refusal(401, 'session_switched'))).toBe(errors.session)
    expect(worded(refusal(418, 'teapot'))).toBe(ar.login.errors.generic)
    // A 429 from a proxy, without the API's code, still says «wait» and keeps the wait it named.
    const throttled = describeTakeFailure(refusal(429, undefined, {}, 12))
    expect(takeFailureMessage(t, throttled)).toBe(errors.rate_limited)
    expect(throttled.retryAfterSeconds).toBe(12)
    expect(describeTakeFailure(refusal(429, 'rate_limited', {}, 3)).retryAfterSeconds).toBe(3)
  })
})

describe('describeSaveFailure — what the page does after a failed save (API-278)', () => {
  it('stops for good on attempt_closed, starts over on answers_invalid and gives up on a 404', () => {
    const closed = describeSaveFailure(refusal(409, 'attempt_closed', { status: 'timed_out' }))
    expect(closed.next).toBe('closed')
    expect(takeFailureMessage(t, closed)).toBe(errors.attempt_closed)
    const invalid = describeSaveFailure(refusal(400, 'answers_invalid', { unknown: ['q'], duplicates: [], malformed: [] }))
    expect(invalid.next).toBe('reset')
    expect(takeFailureMessage(t, invalid)).toBe(errors.answers_invalid)
    const gone = describeSaveFailure(refusal(404, 'attempt_not_found'))
    expect(gone.next).toBe('gone')
    expect(takeFailureMessage(t, gone)).toBe(errors.attempt_not_found)
  })

  it('retries by itself after the network, a timeout, a 5xx and a 429 (with the wait it names)', () => {
    expect(describeSaveFailure(new TypeError('Failed to fetch')).next).toBe('retry')
    expect(describeSaveFailure(new DOMException('The operation was aborted', 'AbortError')).next).toBe('retry')
    expect(describeSaveFailure(refusal(502, undefined)).next).toBe('retry')
    const throttled = describeSaveFailure(refusal(429, 'rate_limited', {}, 9))
    expect(throttled.next).toBe('retry')
    expect(throttled.retryAfterSeconds).toBe(9)
  })

  it('holds — keeps the answers, leaves the retry to the learner — on a refusal that waiting does not fix', () => {
    expect(describeSaveFailure(refusal(403, 'permission_denied', { missing: ['exams.take'] })).next).toBe('hold')
    expect(describeSaveFailure(refusal(401, 'token_invalid')).next).toBe('hold')
    expect(describeSaveFailure(refusal(400, undefined)).next).toBe('hold')
    expect(describeSaveFailure(refusal(413, undefined)).next).toBe('hold')
  })
})

describe('isAttemptGone / isUnknownAttemptId (API-277..API-279)', () => {
  it('reads only a 404 as «not this learner’s attempt»', () => {
    expect(isAttemptGone(refusal(404, 'attempt_not_found', { attemptId: 'x' }))).toBe(true)
    // A 400 is a refused request — the submit refuses any body field — never a missing attempt.
    expect(isAttemptGone(refusal(400, undefined))).toBe(false)
    expect(isAttemptGone(refusal(400, 'answers_invalid'))).toBe(false)
    expect(isAttemptGone(refusal(500, undefined))).toBe(false)
    expect(isAttemptGone(new TypeError('Failed to fetch'))).toBe(false)
  })

  it('knows the 400 of an id no attempt can have — for the first read alone to treat as not found', () => {
    expect(isUnknownAttemptId(refusal(400, undefined, { message: 'Validation failed (uuid is expected)' }))).toBe(true)
    expect(isUnknownAttemptId(refusal(400, 'answers_invalid'))).toBe(false)
    expect(isUnknownAttemptId(refusal(404, 'attempt_not_found'))).toBe(false)
    expect(isUnknownAttemptId(new TypeError('Failed to fetch'))).toBe(false)
  })

  it('words a 400 without a code as a request the server refused, with nothing more to say', () => {
    // What a submit with a body field, or a start with `attemptNo: null`, would get — the client sends neither.
    const failure = describeTakeFailure(refusal(400, undefined, { message: 'property x should not exist' }))
    expect(failure.terminal).toBe(false)
    expect(takeFailureMessage(t, failure)).toBe(ar.login.errors.generic)
  })
})
