// Maps a failed branches request to a translation key under branches.errors.*
// (and, where the backend code points at one input, the form field that should
// carry the message). Codes: backend/src/branches/branches.errors.ts plus the
// auth/permission/origin guards. `branch_is_main` carries an `action`
// (`deactivate` | `promote_inactive` | `delete`) that picks the message.
import { ApiError } from '../api/client'
import type { UsersFailure } from '../users/users.errors'

export { failureMessage } from '../users/users.errors'

/** Same shape as a users failure, so `failureMessage()` renders both. */
export type BranchesFailure = UsersFailure

const KNOWN_CODES = new Set([
  'branch_not_found',
  'branch_code_taken',
  'branch_is_main',
  'branch_in_use',
  'nothing_to_update',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

const IS_MAIN_ACTIONS = new Set(['deactivate', 'promote_inactive', 'delete'])

/** `branch_is_main` is one code for three situations; the message key follows the `action`. */
function messageKeyOf(code: string, body: Record<string, unknown>): string {
  if (code === 'branch_is_main' && typeof body.action === 'string' && IS_MAIN_ACTIONS.has(body.action)) return `branch_is_main_${body.action}`
  return code
}

/** The input the message belongs to (antd name path) — the `isActive` switch for a main-but-inactive outcome. */
function fieldOf(code: string, body: Record<string, unknown>): string[] | undefined {
  if (code === 'branch_code_taken') return ['code']
  if (code === 'branch_is_main' && (body.action === 'deactivate' || body.action === 'promote_inactive')) return ['isActive']
  return undefined
}

function stringList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items.join(', ') : undefined
}

export function describeBranchesFailure(error: unknown): BranchesFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: BranchesFailure = { key: `branches.errors.${messageKeyOf(error.code, body)}` }
    const field = fieldOf(error.code, body)
    if (field) failure.field = field
    const params: Record<string, string> = {}
    const list = stringList(body.missing)
    if (list) params.list = `(${list})`
    if (typeof body.branchCode === 'string') params.branchCode = body.branchCode
    if (typeof body.roomCount === 'number') params.roomCount = String(body.roomCount)
    if (Object.keys(params).length > 0) failure.params = params
    return failure
  }
  if (error.status === 400) {
    // Validation failures carry no code; the server lists the rejected constraints.
    return { key: 'branches.errors.validation', params: { message: error.message } }
  }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
