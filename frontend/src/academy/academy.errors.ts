// Maps a failed academy request to a translation key under settings.errors.*.
// Codes: backend/src/academy/academy.errors.ts (academy_not_configured 503,
// nothing_to_update 400) plus the shared auth/permission/origin codes.
import { ApiError } from '../api/client'
import type { UsersFailure } from '../users/users.errors'

export { failureMessage } from '../users/users.errors'

/** Same shape as a users failure, so `failureMessage()` renders both. */
export type AcademyFailure = UsersFailure

const KNOWN_CODES = new Set(['academy_not_configured', 'nothing_to_update', 'permission_denied', 'origin_forbidden', 'rate_limited'])

function stringList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items.join(', ') : undefined
}

export function describeAcademyFailure(error: unknown): AcademyFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }

  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: AcademyFailure = { key: `settings.errors.${error.code}` }
    const list = stringList(body.missing)
    if (list) failure.params = { list: `(${list})` }
    return failure
  }
  if (error.status === 400) {
    // Validation failures carry no code; the server lists the rejected constraints.
    return { key: 'settings.errors.validation', params: { message: error.message } }
  }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
