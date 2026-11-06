// Maps a failed schedule request to a translation key and the values the
// message needs. Codes: backend/src/schedule/schedule.errors.ts (the T03 part)
// plus the auth/permission guards. A `schedule_conflict` names the resource
// (room or teacher), the row of the submitted list (`slot.index`) and whether
// the other booking sits in the same list or in another class.
import { ApiError } from '../api/client'

export type ConflictScope = 'request' | 'other' | 'unknown'

export interface ScheduleFailure {
  /** Translation key, e.g. `classSchedule.errors.room_inactive`. */
  key: string
  /** Interpolation values for the key. */
  params?: Record<string, string>
  /** The stable backend code, when there is one. */
  code?: string
  /** Index in the submitted list of the row the server refused (a conflict). */
  slotIndex?: number
  /** `classSchedule.resource.room|teacher` — translated into `resource` at render time. */
  resourceKey?: string
  /** `non_working_day`: the refused weekday, translated into `weekday` at render time. */
  weekday?: number
  /** `class_not_schedulable`: the class status, translated through `labels.*`. */
  status?: string
}

export interface ScheduleNames {
  /** Label of a room by id (falls back to the id). */
  roomOf?: (roomId: string) => string | undefined
  /** Name of a teacher by id (falls back to the id). */
  teacherOf?: (userId: string) => string | undefined
}

const KNOWN_CODES = new Set([
  'class_not_found',
  'class_not_schedulable',
  'schedule_invalid',
  'non_working_day',
  'room_not_found',
  'room_inactive',
  'teacher_not_assigned',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

/** After these the editor's starting point no longer matches the server: the schedule is re-read. */
const STALE_CODES = new Set(['class_not_found', 'class_not_schedulable', 'schedule_invalid'])

export function isStaleFailure(failure: ScheduleFailure): boolean {
  return failure.code !== undefined && STALE_CODES.has(failure.code)
}

function stringList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items.join(', ') : undefined
}

/** `classId` is the class being edited: a conflicting booking of that class is one inside the submitted list. */
export function describeScheduleFailure(error: unknown, classId: string, names: ScheduleNames = {}): ScheduleFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  const code = error.code
  if (code === 'schedule_conflict') {
    const kind = body.kind === 'teacher' ? 'teacher' : 'room'
    const slot = typeof body.slot === 'object' && body.slot !== null ? (body.slot as { index?: unknown }) : null
    const index = typeof slot?.index === 'number' ? slot.index : undefined
    const other = body.conflictingClassId
    const scope: ConflictScope = typeof other !== 'string' ? 'unknown' : other === classId ? 'request' : 'other'
    const failure: ScheduleFailure = {
      code,
      key: `classSchedule.errors.schedule_conflict_${scope}`,
      resourceKey: `classSchedule.resource.${kind}`,
      params: { slot: index !== undefined ? String(index + 1) : '' },
    }
    if (index !== undefined) failure.slotIndex = index
    return failure
  }
  if (code && KNOWN_CODES.has(code)) {
    const failure: ScheduleFailure = { code, key: `classSchedule.errors.${code}` }
    const params: Record<string, string> = {}
    if (code === 'non_working_day' && typeof body.weekday === 'number') failure.weekday = body.weekday
    if (code === 'class_not_schedulable' && typeof body.status === 'string') failure.status = body.status
    if ((code === 'room_not_found' || code === 'room_inactive') && typeof body.roomId === 'string') params.name = names.roomOf?.(body.roomId) ?? body.roomId
    if (code === 'teacher_not_assigned' && typeof body.userId === 'string') params.name = names.teacherOf?.(body.userId) ?? body.userId
    const list = stringList(body.missing)
    if (list) params.list = `(${list})`
    if (Object.keys(params).length > 0) failure.params = params
    return failure
  }
  if (error.status === 400) return { key: 'classSchedule.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}

/** The message of a failure, with the resource, weekday and status names translated. */
export function scheduleFailureMessage(t: (key: string, options?: Record<string, unknown>) => string, failure: ScheduleFailure): string {
  const params: Record<string, string> = { list: '', message: '', ...failure.params }
  if (failure.resourceKey) params.resource = t(failure.resourceKey)
  if (failure.weekday !== undefined) params.weekday = t(`classSchedule.weekdays.${failure.weekday}`)
  if (failure.status) params.status = t(`labels.${failure.status}`)
  return t(failure.key, params).trim()
}
