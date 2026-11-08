// Pure part of the «generate lessons» panel (J-F16 on API-092): the local
// mirror of the server's range check (`IsGenerationRange` in
// backend/src/schedule/lesson-generation.dto.ts — real dates, `to` not before
// `from`, at most GENERATION_MAX_DAYS days counted inclusively), the range the
// panel starts with, and the translation of a refusal. The server stays the
// boundary: a double booking against an existing lesson is only known there.
// A refusal writes nothing (one transaction for the whole batch), and a retry
// is safe because the server skips every (slot, date) that already has a lesson.
import type { AcademyClass } from '../api/classes'
import { ApiError } from '../api/client'
import { GENERATION_MAX_DAYS } from '../api/schedule'
import { addDays } from '../timetable/timetable.dates'
import { isCalendarDate } from './schedule.model'

export { GENERATION_MAX_DAYS }

/** Length of the default range when the class has no end date after its start: four weeks. */
export const DEFAULT_GENERATION_DAYS = 28

const DAY_MS = 86_400_000

export interface GenerationRange {
  from: string
  to: string
}

/** Days from `from` to `to`, both included (1 for a single day; 0 or less when `to` is earlier). Both must be calendar dates. */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) + 1
}

export type GenerationRangeProblem = 'from_required' | 'to_required' | 'to_not_before_from' | 'range_too_long'

export interface GenerationRangeProblems {
  from?: 'from_required'
  to?: Exclude<GenerationRangeProblem, 'from_required'>
}

/** What the server's DTO would refuse; empty when the range is accepted as far as the client can tell. */
export function generationRangeProblems({ from, to }: GenerationRange): GenerationRangeProblems {
  const problems: GenerationRangeProblems = {}
  if (!isCalendarDate(from)) problems.from = 'from_required'
  if (!isCalendarDate(to)) {
    problems.to = 'to_required'
  } else if (isCalendarDate(from)) {
    const days = inclusiveDays(from, to)
    if (days < 1) problems.to = 'to_not_before_from'
    else if (days > GENERATION_MAX_DAYS) problems.to = 'range_too_long'
  }
  return problems
}

export function hasRangeProblems(problems: GenerationRangeProblems): boolean {
  return problems.from !== undefined || problems.to !== undefined
}

/**
 * The range the panel starts with: from `today`, or from the class's first day
 * when it starts later; to the class's last day when it has one on or after
 * that (cut to GENERATION_MAX_DAYS), else four weeks. The class dates are
 * display dates (D-R17) — a convenience only; the manager changes both freely.
 */
export function defaultGenerationRange(cls: Pick<AcademyClass, 'startsOn' | 'endsOn'>, today: string): GenerationRange {
  const from = isCalendarDate(cls.startsOn) && cls.startsOn > today ? cls.startsOn : today
  const last = addDays(from, GENERATION_MAX_DAYS - 1)
  const to = isCalendarDate(cls.endsOn) && cls.endsOn >= from ? (cls.endsOn < last ? cls.endsOn : last) : addDays(from, DEFAULT_GENERATION_DAYS - 1)
  return { from, to }
}

/** Where the lesson that blocks a generated one sits: in this class, in another class, or not known. */
export type LessonConflictScope = 'same' | 'other' | 'unknown'

export interface GenerationFailure {
  /** Translation key, e.g. `classSchedule.generate.errors.room_inactive`. */
  key: string
  /** Interpolation values for the key. */
  params?: Record<string, string>
  /** The stable backend code, when there is one. */
  code?: string
  /** `class_not_schedulable` / `class_closed`: the class status, translated through `labels.*`. */
  status?: string
  /** `lesson_conflict`: the existing lesson a generated one would double-book. */
  conflictingLessonId?: string
  /** The server refused the request (4xx): nothing was written. */
  refused: boolean
  /** The fix sits in a slot of the weekly schedule (its room or its teacher): the panel offers the editor. */
  fixInSchedule: boolean
}

export interface GenerationNames {
  /** Label of a room by id (falls back to the id). */
  roomOf?: (roomId: string) => string | undefined
  /** Name of a teacher by id (falls back to the id). */
  teacherOf?: (userId: string) => string | undefined
}

const GENERATION_CODES = new Set(['class_not_found', 'class_not_schedulable', 'class_closed', 'room_not_found', 'room_inactive', 'teacher_not_assigned'])
/** Codes of the API-089 dictionary whose messages fit this request as they are. */
const SHARED_CODES = new Set(['permission_denied', 'origin_forbidden', 'rate_limited'])
const SLOT_FIX_CODES = new Set(['room_not_found', 'room_inactive', 'teacher_not_assigned', 'lesson_conflict'])

function stringList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items.join(', ') : undefined
}

/** `classId` is the class whose schedule generates the lessons: a blocking lesson of that class is `same`. */
export function describeGenerationFailure(error: unknown, classId: string, names: GenerationNames = {}): GenerationFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network', refused: false, fixInSchedule: false }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  const code = error.code ?? undefined
  const refused = error.status >= 400 && error.status < 500
  const fixInSchedule = code !== undefined && SLOT_FIX_CODES.has(code)

  if (code === 'lesson_conflict') {
    const resource = body.resource === 'teacher' ? 'teacher' : 'room'
    const other = body.conflictingClassId
    const scope: LessonConflictScope = typeof other !== 'string' ? 'unknown' : other === classId ? 'same' : 'other'
    const failure: GenerationFailure = { code, key: `classSchedule.generate.errors.lesson_conflict.${resource}.${scope}`, refused, fixInSchedule }
    if (typeof body.conflictingLessonId === 'string') failure.conflictingLessonId = body.conflictingLessonId
    return failure
  }
  if (code && GENERATION_CODES.has(code)) {
    const failure: GenerationFailure = { code, key: `classSchedule.generate.errors.${code}`, refused, fixInSchedule }
    if ((code === 'class_not_schedulable' || code === 'class_closed') && typeof body.status === 'string') failure.status = body.status
    if ((code === 'room_not_found' || code === 'room_inactive') && typeof body.roomId === 'string') failure.params = { name: names.roomOf?.(body.roomId) ?? body.roomId }
    if (code === 'teacher_not_assigned' && typeof body.userId === 'string') failure.params = { name: names.teacherOf?.(body.userId) ?? body.userId }
    return failure
  }
  if (code && SHARED_CODES.has(code)) {
    const failure: GenerationFailure = { code, key: `classSchedule.errors.${code}`, refused, fixInSchedule }
    const list = stringList(body.missing)
    if (list) failure.params = { list: `(${list})` }
    return failure
  }
  if (error.status === 400) return { key: 'classSchedule.errors.validation', params: { message: error.message }, refused, fixInSchedule }
  if (error.status >= 500) return { key: 'login.errors.server', refused, fixInSchedule }
  return { key: 'login.errors.generic', refused, fixInSchedule }
}

/** The message of a failure, with the status name translated. */
export function generationFailureMessage(t: (key: string, options?: Record<string, unknown>) => string, failure: GenerationFailure): string {
  const params: Record<string, string> = { list: '', message: '', name: '', ...failure.params }
  if (failure.status) params.status = t(`labels.${failure.status}`)
  return t(failure.key, params).trim()
}
