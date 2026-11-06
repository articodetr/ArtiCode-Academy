// Maps a failed schedule request to a translation key (J-F05). The timetable
// readings have no codes of their own beyond validation and the guards:
// permission_denied (with the missing keys), 400 validation, network/server.
import { ApiError } from '../api/client'
import type { UsersFailure } from '../users/users.errors'

export { failureMessage } from '../users/users.errors'

export type ScheduleFailure = UsersFailure

function stringList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items.join(', ') : undefined
}

export function describeScheduleFailure(error: unknown): ScheduleFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code === 'permission_denied' || error.code === 'origin_forbidden' || error.code === 'rate_limited') {
    const list = stringList(body.missing)
    return { key: `schedule.errors.${error.code}`, ...(list ? { params: { list: `(${list})` } } : {}) }
  }
  if (error.status === 400) return { key: 'schedule.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
