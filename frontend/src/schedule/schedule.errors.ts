// Maps a failed schedule request to a translation key and the values the
// message needs. Codes: backend/src/schedule/schedule.errors.ts (the T03 part)
// plus the auth/permission guards. A `schedule_conflict` has one message per
// resource (room or teacher — Arabic agreement differs: القاعة محجوزة / المعلم
// محجوز) and per scope (the other booking sits in the same list, in another
// class, or is unknown) and names the refused row of the editor. Against
// another class the server's `slot.index` counted the slots it writes (new ones
// first), not the editor's rows, until CH-0106 fixed it (the owner's KI-072);
// the row is found by the values the server echoes in `slot`, which stays
// right either way.
import { ApiError } from '../api/client'
import { toSlotInput } from './schedule.model'
import type { SlotDraft } from './schedule.model'

export type ConflictScope = 'request' | 'other' | 'unknown'

export interface ScheduleFailure {
  /** Translation key, e.g. `classSchedule.errors.room_inactive`. */
  key: string
  /** Interpolation values for the key. */
  params?: Record<string, string>
  /** The stable backend code, when there is one. */
  code?: string
  /** Index in the editor's list of the row the server refused (a conflict). */
  slotIndex?: number
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

/** The refused slot as `schedule_conflict` echoes it: `index` plus the slot's values. */
interface EchoedSlot {
  index?: unknown
  weekday?: unknown
  startTime?: unknown
  endTime?: unknown
  roomId?: unknown
  teacherUserId?: unknown
  effectiveFrom?: unknown
  effectiveTo?: unknown
}

/**
 * The editor row the server refused: the first draft whose values equal the
 * echoed slot; else, for a conflict inside the list only, the echoed index
 * (the request index). Against another class the index counted the slots the
 * server writes, new ones first, until CH-0106 (KI-072), so it is not trusted
 * there.
 */
export function refusedRow(slot: EchoedSlot | null, drafts: readonly SlotDraft[], scope: ConflictScope): number | undefined {
  if (!slot) return undefined
  const row = drafts.findIndex((draft) => {
    const values = toSlotInput(draft)
    return (
      values.weekday === slot.weekday &&
      values.startTime === slot.startTime &&
      values.endTime === slot.endTime &&
      values.roomId === (slot.roomId ?? null) &&
      values.teacherUserId === (slot.teacherUserId ?? null) &&
      values.effectiveFrom === slot.effectiveFrom &&
      values.effectiveTo === (slot.effectiveTo ?? null)
    )
  })
  if (row !== -1) return row
  return scope === 'request' && typeof slot.index === 'number' ? slot.index : undefined
}

/**
 * `classId` is the class being edited: a conflicting booking of that class is
 * one inside the submitted list. `drafts` is the list that was sent (the
 * editor's rows), used to name the refused row of a conflict.
 */
export function describeScheduleFailure(error: unknown, classId: string, names: ScheduleNames = {}, drafts: readonly SlotDraft[] = []): ScheduleFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  const code = error.code
  if (code === 'schedule_conflict') {
    const kind = body.kind === 'teacher' ? 'teacher' : 'room'
    const slot = typeof body.slot === 'object' && body.slot !== null ? (body.slot as EchoedSlot) : null
    const other = body.conflictingClassId
    const scope: ConflictScope = typeof other !== 'string' ? 'unknown' : other === classId ? 'request' : 'other'
    const row = scope === 'unknown' ? undefined : refusedRow(slot, drafts, scope)
    // Without a row the message names none (the `unknown` text).
    if (row === undefined) return { code, key: `classSchedule.errors.schedule_conflict.${kind}.unknown` }
    return { code, key: `classSchedule.errors.schedule_conflict.${kind}.${scope}`, params: { slot: String(row + 1) }, slotIndex: row }
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

/** The message of a failure, with the weekday and status names translated. */
export function scheduleFailureMessage(t: (key: string, options?: Record<string, unknown>) => string, failure: ScheduleFailure): string {
  const params: Record<string, string> = { list: '', message: '', ...failure.params }
  if (failure.weekday !== undefined) params.weekday = t(`classSchedule.weekdays.${failure.weekday}`)
  if (failure.status) params.status = t(`labels.${failure.status}`)
  return t(failure.key, params).trim()
}
