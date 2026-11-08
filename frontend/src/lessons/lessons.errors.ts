// Maps a failed lessons request to a translation key (and, where the backend
// code points at one input, the form field that should carry the message).
// Codes: backend/src/lessons/lessons.errors.ts (all 18, the two attendance
// codes included for MOD-06-T03) plus the auth/permission guards.
import { ApiError } from '../api/client'
import { failureMessage as usersFailureMessage } from '../users/users.errors'
import type { UsersFailure } from '../users/users.errors'

/** A users failure plus, for `lesson_locked`, the refused fields as the server names them. */
export interface LessonsFailure extends UsersFailure {
  lockedFields?: string[]
}

/** The PATCH fields of API-096 (`LESSON_PATCH_FIELDS` of lessons.changes.ts) — each has a `lessons.patchFields.*` label. */
const PATCH_FIELDS = new Set(['title', 'description', 'deliveryMode', 'startsAt', 'endsAt', 'roomId', 'teacherUserId', 'syllabusItemId', 'meetingUrl'])

/** The failure's text; `lesson_locked` lists the refused fields by their translated labels, not their API names. */
export function failureMessage(t: (key: string, options?: Record<string, unknown>) => string, failure: LessonsFailure): string {
  if (!failure.lockedFields?.length) return usersFailureMessage(t, failure)
  const names = failure.lockedFields.map((field) => (PATCH_FIELDS.has(field) ? t(`lessons.patchFields.${field}`) : field))
  return usersFailureMessage(t, { ...failure, params: { ...failure.params, list: `(${names.join(t('lessons.errors.listSeparator'))})` } })
}

const KNOWN_CODES = new Set([
  'lesson_not_found',
  'class_not_found',
  'class_closed',
  'teacher_not_assigned',
  'syllabus_item_not_found',
  'syllabus_item_mismatch',
  'room_not_found',
  'room_inactive',
  'time_range_invalid',
  'lesson_conflict',
  'lesson_locked',
  'lesson_not_started',
  'invalid_transition',
  'lesson_not_deletable',
  'nothing_to_update',
  'cursor_invalid',
  'attendance_closed',
  'not_enrolled',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

/** Form fields (LessonFormValues) a code points at. */
const FIELD_OF_CODE: Readonly<Record<string, string[]>> = {
  class_not_found: ['classId'],
  class_closed: ['classId'],
  teacher_not_assigned: ['teacherUserId'],
  syllabus_item_not_found: ['syllabusItemId'],
  syllabus_item_mismatch: ['syllabusItemId'],
  room_not_found: ['roomId'],
  room_inactive: ['roomId'],
  time_range_invalid: ['endTime'],
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function stringList(value: unknown): string | undefined {
  const items = strings(value)
  return items.length > 0 ? items.join(', ') : undefined
}

/** `lesson_conflict` names the booked resource; the message (and the field) follow it. */
function messageKeyOf(code: string, body: Record<string, unknown>): string {
  if (code === 'lesson_conflict') return body.resource === 'teacher' ? 'lesson_conflict_teacher' : 'lesson_conflict_room'
  return code
}

export function describeLessonsFailure(error: unknown): LessonsFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: LessonsFailure = { key: `lessons.errors.${messageKeyOf(error.code, body)}` }
    const field = FIELD_OF_CODE[error.code]
    if (field) failure.field = field
    if (error.code === 'lesson_conflict') failure.field = body.resource === 'teacher' ? ['teacherUserId'] : ['roomId']
    if (error.code === 'lesson_locked' && strings(body.fields).length > 0) failure.lockedFields = strings(body.fields)
    const params: Record<string, string> = {}
    const list = stringList(body.missing) ?? stringList(body.studentIds)
    if (list) params.list = `(${list})`
    if (typeof body.attendanceCount === 'number') params.attendanceCount = String(body.attendanceCount)
    if (typeof body.maxHours === 'number') params.maxHours = String(body.maxHours)
    if (Object.keys(params).length > 0) failure.params = params
    return failure
  }
  if (error.status === 400) return { key: 'lessons.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
