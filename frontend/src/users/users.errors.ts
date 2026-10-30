// Maps a failed users request to a translation key (and, where the backend
// code points at one input, the form field that should carry the message).
// Codes: backend/src/users/users.errors.ts (+ guardians.errors.ts) and the
// auth/permission guards.
import { ApiError } from '../api/client'

export interface UsersFailure {
  /** Translation key, e.g. `users.errors.email_in_use`. */
  key: string
  /** Interpolation values for the key. */
  params?: Record<string, string>
  /** Form field (antd name path) the message belongs to, when the code names one. */
  field?: string[]
}

/** Codes with a dedicated message under users.errors.*. */
const KNOWN_CODES = new Set([
  'user_not_found',
  'cursor_invalid',
  'identifier_required',
  'email_in_use',
  'username_in_use',
  'student_number_in_use',
  'employee_number_in_use',
  'profile_mismatch',
  'employee_kind_required',
  'role_unknown',
  'nothing_to_update',
  'user_not_invitable',
  'user_not_resettable',
  // T14 — account status, soft delete, role assignment and guardian links
  'invalid_transition',
  'self_forbidden',
  'last_admin',
  'not_a_guardian',
  'not_a_student',
  'already_linked',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

/** `self_forbidden` of API-034 carries this `action`; the status actions carry `suspend`/`archive`/`delete`. */
const SELF_FORBIDDEN_ROLES_ACTION = 'remove_academy_admin'

/**
 * One backend code can carry two situations told apart by the details; the
 * message key follows the situation (users.errors.<key>).
 */
function messageKeyOf(code: string, body: Record<string, unknown>): string {
  if (code === 'self_forbidden' && body.action === SELF_FORBIDDEN_ROLES_ACTION) return 'self_forbidden_roles'
  if (code === 'user_not_found') {
    if (body.reason === 'not_linked') return 'not_linked'
    if (body.party === 'guardian') return 'guardian_not_found'
    if (body.party === 'student') return 'student_not_found'
  }
  return code
}

const FIELD_OF_CODE: Readonly<Record<string, string[]>> = {
  email_in_use: ['email'],
  username_in_use: ['username'],
  student_number_in_use: ['studentProfile', 'studentNumber'],
  employee_number_in_use: ['employeeProfile', 'employeeNumber'],
  role_unknown: ['roleKeys'],
}

function stringList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items.join(', ') : undefined
}

/** Translates a failure; keys with an optional `{{list}}`/`{{message}}` render cleanly without one. */
export function failureMessage(t: (key: string, options?: Record<string, unknown>) => string, failure: UsersFailure): string {
  return t(failure.key, { list: '', message: '', ...failure.params }).trim()
}

export function describeUsersFailure(error: unknown): UsersFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }

  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: UsersFailure = { key: `users.errors.${messageKeyOf(error.code, body)}` }
    const field = FIELD_OF_CODE[error.code]
    if (field) failure.field = field
    const list = stringList(body.missing) ?? stringList(body.roleKeys)
    if (list) failure.params = { list: `(${list})` }
    return failure
  }
  if (error.status === 400) {
    // Validation failures carry no code; the server lists the rejected constraints.
    return { key: 'users.errors.validation', params: { message: error.message } }
  }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
