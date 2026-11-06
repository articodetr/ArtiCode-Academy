// Maps a failed rooms request to a translation key (and, where the backend
// code points at one input, the form field that should carry the message).
// Codes: backend/src/schedule/schedule.errors.ts (the room and branch part)
// plus the auth/permission guards. The class-schedule codes belong to the
// schedule screen.
import { ApiError } from '../api/client'
import type { UsersFailure } from '../users/users.errors'

export { failureMessage } from '../users/users.errors'

/** Same shape as a users failure, so `failureMessage()` renders both. */
export type RoomsFailure = UsersFailure

const KNOWN_CODES = new Set([
  'room_not_found',
  'room_code_taken',
  'room_in_use',
  'branch_not_found',
  'branch_inactive',
  'nothing_to_update',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

const FIELD_OF_CODE: Readonly<Record<string, string[]>> = {
  room_code_taken: ['code'],
  branch_not_found: ['branchId'],
  branch_inactive: ['branchId'],
}

function stringList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items.join(', ') : undefined
}

export function describeRoomsFailure(error: unknown): RoomsFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: RoomsFailure = { key: `rooms.errors.${error.code}` }
    const field = FIELD_OF_CODE[error.code]
    if (field) failure.field = field
    const params: Record<string, string> = {}
    const list = stringList(body.missing)
    if (list) params.list = `(${list})`
    if (typeof body.roomCode === 'string') params.roomCode = body.roomCode
    if (typeof body.slotCount === 'number') params.slotCount = String(body.slotCount)
    if (Object.keys(params).length > 0) failure.params = params
    return failure
  }
  if (error.status === 400) return { key: 'rooms.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
