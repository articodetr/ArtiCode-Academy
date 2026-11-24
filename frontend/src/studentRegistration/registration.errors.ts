// What a refused registration request means for its screen (the agreed contract v2 in GitHub #207). Every message is a
// translation key of this app: neither a server message nor a server-sent field value is ever shown. No React.
import { REGISTRATION_PROBLEMS } from '../api/registration'
import type { RegistrationProblem } from '../api/registration'
import { ApiError } from '../api/client'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../account/account.links'

export interface RegistrationMessage {
  key: string
  params?: Record<string, string | number>
}

export type RegistrationField = 'fullName' | 'email' | 'password'

export interface RegistrationFieldError {
  name: RegistrationField
  messages: RegistrationMessage[]
}

export type RegistrationFailure =
  /** 403 registration_disabled: the academy is not taking registrations. */
  | { kind: 'closed' }
  /** The link can never work: invalid, used or replaced. */
  | { kind: 'link_invalid' }
  /** The link ran out: the visitor registers again with the same address. */
  | { kind: 'link_expired' }
  /** Problems under their own fields; the form and what was typed stay. */
  | { kind: 'fields'; fields: RegistrationFieldError[] }
  /** Anything else: one message, and the form and what was typed stay. */
  | ({ kind: 'message' } & RegistrationMessage)

const PROBLEMS: ReadonlySet<string> = new Set(REGISTRATION_PROBLEMS)

function fieldMessage(name: RegistrationField, problem: string): RegistrationMessage {
  if (name === 'password') {
    return { key: 'account.validation.passwordPolicy', params: { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH } }
  }
  // A problem code this build does not know reads as a wrong format, never as the raw code.
  const known: RegistrationProblem = PROBLEMS.has(problem) ? (problem as RegistrationProblem) : 'invalid_format'
  return { key: `studentRegistration.validation.${name}.${known}` }
}

/** The problems of `400 registration_invalid` for the fields this screen shows, one message per distinct wording. */
export function fieldErrorsOf(body: unknown, shown: readonly RegistrationField[]): RegistrationFieldError[] {
  if (typeof body !== 'object' || body === null) return []
  const { fields } = body as { fields?: unknown }
  if (typeof fields !== 'object' || fields === null) return []
  const errors: RegistrationFieldError[] = []
  for (const name of shown) {
    if (!Object.hasOwn(fields, name)) continue
    const problems = (fields as Record<string, unknown>)[name]
    if (!Array.isArray(problems)) continue
    const messages = new Map<string, RegistrationMessage>()
    for (const problem of problems) {
      if (typeof problem !== 'string') continue
      const message = fieldMessage(name, problem)
      messages.set(message.key, message)
    }
    if (messages.size > 0) errors.push({ name, messages: [...messages.values()] })
  }
  return errors
}

/** A 429 in words: how long to wait when the server named it, in whole minutes rounded up. */
export function rateLimitMessage(retryAfterSeconds: number | null): RegistrationMessage {
  if (retryAfterSeconds === null || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return { key: 'studentRegistration.errors.rateLimited' }
  }
  if (retryAfterSeconds < 60) return { key: 'studentRegistration.errors.rateLimitedSoon' }
  return { key: 'studentRegistration.errors.rateLimitedMinutes', params: { count: Math.ceil(retryAfterSeconds / 60) } }
}

function generalMessage(error: unknown): RegistrationMessage {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  if (error.status === 429 || error.code === 'rate_limited') return rateLimitMessage(error.retryAfterSeconds)
  if (error.code === 'origin_forbidden') return { key: 'users.errors.origin_forbidden' }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}

function invalidFailure(error: ApiError, shown: readonly RegistrationField[]): RegistrationFailure {
  const fields = fieldErrorsOf(error.body, shown)
  return fields.length > 0 ? { kind: 'fields', fields } : { kind: 'message', key: 'studentRegistration.errors.invalid' }
}

function linkVerdict(error: unknown): RegistrationFailure | null {
  if (!(error instanceof ApiError)) return null
  if (error.code === 'registration_disabled') return { kind: 'closed' }
  if (error.code === 'registration_link_expired' || (error.status === 410 && !error.code)) return { kind: 'link_expired' }
  if (error.code === 'registration_link_invalid' || (error.status === 404 && !error.code)) return { kind: 'link_invalid' }
  return null
}

/** A refused `POST /api/account/register`. */
export function describeRegisterFailure(error: unknown): RegistrationFailure {
  if (error instanceof ApiError) {
    if (error.code === 'registration_disabled') return { kind: 'closed' }
    if (error.code === 'registration_invalid') return invalidFailure(error, ['fullName', 'email'])
  }
  return { kind: 'message', ...generalMessage(error) }
}

/** A refused `GET /api/account/register/:token`: a `message` here is one the page offers to retry. */
export function describeLinkFailure(error: unknown): RegistrationFailure {
  return linkVerdict(error) ?? { kind: 'message', ...generalMessage(error) }
}

/** A refused `POST /api/account/register/:token/complete`. */
export function describeCompleteFailure(error: unknown): RegistrationFailure {
  const verdict = linkVerdict(error)
  if (verdict) return verdict
  if (error instanceof ApiError) {
    if (error.code === 'password_weak') {
      return {
        kind: 'fields',
        fields: [
          { name: 'password', messages: [{ key: 'account.errors.password_weak', params: { min: PASSWORD_MIN_LENGTH } }] },
        ],
      }
    }
    if (error.code === 'registration_invalid') return invalidFailure(error, ['fullName', 'password'])
  }
  return { kind: 'message', ...generalMessage(error) }
}
