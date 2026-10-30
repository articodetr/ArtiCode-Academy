// Maps a failed roles request to a translation key (and the form field that
// should carry the message when the code points at one input).
// Codes: backend/src/roles/roles.errors.ts (role_unknown, role_in_use with two
// meanings, role_immutable, permission_unknown) plus the shared MOD-03/auth codes.
import { ApiError } from '../api/client'
import type { UsersFailure } from '../users/users.errors'

export { failureMessage } from '../users/users.errors'

/** Same shape as a users failure, so `failureMessage()` renders both. */
export type RolesFailure = UsersFailure

/** Codes with a dedicated message under rolesAdmin.errors.* (`role_in_use` is split by its details). */
const KNOWN_CODES = new Set([
  'role_unknown',
  'role_in_use',
  'role_immutable',
  'permission_unknown',
  'nothing_to_update',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

function stringList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items.join(', ') : undefined
}

export function describeRolesFailure(error: unknown): RolesFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }

  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  const code = error.code
  if (code && KNOWN_CODES.has(code)) {
    if (code === 'role_in_use') {
      // DELETE: the role is granted to `userCount` users; POST: the key is taken or reserved.
      if (typeof body.userCount === 'number') {
        return { key: 'rolesAdmin.errors.role_in_use_users', params: { count: String(body.userCount) } }
      }
      return { key: 'rolesAdmin.errors.role_in_use_key', field: ['key'] }
    }
    const failure: RolesFailure = { key: `rolesAdmin.errors.${code}` }
    const list = stringList(body.missing) ?? stringList(body.permissions) ?? stringList(body.fields)
    if (list) failure.params = { list: `(${list})` }
    if (code === 'permission_unknown') failure.field = ['permissions']
    return failure
  }
  if (error.status === 400) {
    // Validation failures carry no code; the server lists the rejected constraints.
    return { key: 'rolesAdmin.errors.validation', params: { message: error.message } }
  }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
