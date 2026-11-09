// Maps a failed request of «my assignments» (API-112 list, API-109 attempt,
// API-110 read) to a translation key under `myAssignments.errors` (and, where
// the backend names one input, the form field that should carry it). Codes:
// the learner's part of backend/src/assignments/assignments.errors.ts plus the
// auth/permission guards. `terminal` marks a refusal no retry of the same
// attempt can change (the assignment, the enrollment or the attempts moved on):
// the modal stops offering to send and the page re-reads the list. Unit-tested
// in myAssignments.errors.test.ts.
import { ApiError } from '../api/client'
import { failureMessage as usersFailureMessage } from '../users/users.errors'
import type { UsersFailure } from '../users/users.errors'

export interface MyAssignmentsFailure extends UsersFailure {
  terminal: boolean
}

const TERMINAL_CODES = new Set(['assignment_closed', 'attempts_exhausted', 'not_enrolled', 'assignment_not_found', 'permission_denied'])

const KNOWN_CODES = new Set([...TERMINAL_CODES, 'submission_invalid', 'submission_not_found', 'cursor_invalid', 'origin_forbidden', 'rate_limited'])

const CLOSED_REASONS = new Set(['not_published', 'closed', 'past_due'])

/** Fields of the attempt form a refusal points at. */
const FIELD_OF_CODE: Readonly<Record<string, string[]>> = {
  submission_invalid: ['textAnswer'],
}

export const failureMessage = usersFailureMessage

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—'
}

/** A 400 without a code is the DTO's validation; its English message names the field it refused. */
function validationFailure(message: string): MyAssignmentsFailure {
  if (/linkUrl/.test(message)) return { key: 'myAssignments.validation.link', field: ['linkUrl'], terminal: false }
  if (/textAnswer/.test(message)) return { key: 'myAssignments.validation.textInvalid', field: ['textAnswer'], terminal: false }
  return { key: 'myAssignments.errors.validation', params: { message }, terminal: false }
}

export function describeMyAssignmentsFailure(error: unknown): MyAssignmentsFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network', terminal: false }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  const code = error.code
  if (code && KNOWN_CODES.has(code)) {
    const terminal = TERMINAL_CODES.has(code)
    if (code === 'assignment_closed') {
      const reason = typeof body.reason === 'string' && CLOSED_REASONS.has(body.reason) ? body.reason : 'closed'
      return { key: `myAssignments.errors.assignment_closed_${reason}`, terminal }
    }
    if (code === 'attempts_exhausted') {
      // The server puts the effective limit (maxAttempts plus the returned attempts) in `maxAttempts`.
      return { key: 'myAssignments.errors.attempts_exhausted', params: { attempts: numberText(body.attempts), allowed: numberText(body.maxAttempts) }, terminal }
    }
    const failure: MyAssignmentsFailure = { key: `myAssignments.errors.${code}`, terminal }
    const field = FIELD_OF_CODE[code]
    if (field) failure.field = field
    const missing = strings(body.missing)
    if (missing.length > 0) failure.params = { list: `(${missing.join(', ')})` }
    return failure
  }
  if (error.status === 400) return validationFailure(error.message)
  if (error.status >= 500) return { key: 'login.errors.server', terminal: false }
  return { key: 'login.errors.generic', terminal: false }
}

/** True for the failure of one code. */
export function isMyAssignmentsFailure(failure: MyAssignmentsFailure, code: string): boolean {
  return failure.key === `myAssignments.errors.${code}`
}
