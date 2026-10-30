// Maps a failed audit log request to a translation key. API-011 is a read:
// the only coded refusals are the shared auth/permission/origin/rate codes,
// and a 400 (validation) carries the server's message.
import { ApiError } from '../api/client'
import type { UsersFailure } from '../users/users.errors'

export { failureMessage } from '../users/users.errors'

/** Same shape as a users failure, so `failureMessage()` renders both. */
export type AuditFailure = UsersFailure

/** Codes with a dedicated message under audit.errors.*. */
const KNOWN_CODES = new Set(['permission_denied', 'origin_forbidden', 'rate_limited'])

function stringList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items.join(', ') : undefined
}

export function describeAuditFailure(error: unknown): AuditFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }

  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: AuditFailure = { key: `audit.errors.${error.code}` }
    const list = stringList(body.missing)
    if (list) failure.params = { list: `(${list})` }
    return failure
  }
  if (error.status === 400) {
    // Validation failures carry no code; the server lists the rejected constraints.
    return { key: 'audit.errors.validation', params: { message: error.message } }
  }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
