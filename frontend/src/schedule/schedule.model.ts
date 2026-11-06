// Pure model of the weekly schedule editor (J-F07 on API-088/API-089): the
// drafts of the slot list, the local mirrors of the server checks
// (backend/src/schedule/schedule.changes.ts and schedule.time.ts — end after
// start, `effectiveTo` not before `effectiveFrom`, the academy's working days
// (D-R28), a room or a teacher double-booked inside the list) and the PUT body,
// which is sent only when the list differs from what the server holds (order
// does not matter — the server sorts and applies a diff). The server stays the
// boundary: a conflict with another class is only known there.
import type { ClassStatus } from '../api/classes'
import { SCHEDULE_SLOTS_MAX, WEEKDAYS } from '../api/schedule'
import type { ReplaceClassScheduleInput, ScheduleSlot, ScheduleSlotInput, Weekday } from '../api/schedule'

export { SCHEDULE_SLOTS_MAX }

/** Class states whose schedule may be edited — mirror of `SCHEDULABLE_CLASS_STATUSES` (a completed or cancelled class is frozen). */
const SCHEDULABLE_STATUSES: readonly ClassStatus[] = ['planned', 'open', 'running']

export function isSchedulable(status: ClassStatus): boolean {
  return SCHEDULABLE_STATUSES.includes(status)
}

/** `HH:MM`, 00:00–23:59 (mirror of `CLOCK_TIME_PATTERN`). */
export const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && CLOCK_TIME_PATTERN.test(value)
}

/** `YYYY-MM-DD` naming a real day (mirror of `isCalendarDate` in users.validation.ts). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !CALENDAR_DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Minutes since midnight of an `HH:MM` value. */
export function clockMinutes(value: string): number {
  const [hours = 0, minutes = 0] = value.split(':').map(Number)
  return hours * 60 + minutes
}

/** Half-open time ranges `[start, end)`: adjacent slots (10–11 and 11–12) do not overlap — as the EXCLUDE constraint. */
export function clockRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return clockMinutes(aStart) < clockMinutes(bEnd) && clockMinutes(bStart) < clockMinutes(aEnd)
}

/** Inclusive date ranges; a `null` end is open-ended — as `daterange(from, to, '[]')`. */
export function dateRangesOverlap(aFrom: string, aTo: string | null, bFrom: string, bTo: string | null): boolean {
  return (aTo === null || aTo >= bFrom) && (bTo === null || bTo >= aFrom)
}

/** Today as `YYYY-MM-DD` in the browser's zone: the default `effectiveFrom` of a new slot. */
export function todayCalendarDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** The seven weekdays starting at `settings.scheduling.weekStartsOn` (null = Sunday, the server's numbering). */
export function orderedWeekdays(weekStartsOn: number | null): number[] {
  const start = weekStartsOn !== null && (WEEKDAYS as readonly number[]).includes(weekStartsOn) ? (weekStartsOn as Weekday) : 0
  return WEEKDAYS.map((_, index) => (start + index) % 7)
}

/** One row of the editor; `key` identifies the row (the slot id for a kept slot, a local key for a new one). */
export interface SlotDraft {
  key: string
  id?: string
  weekday: number | null
  startTime: string
  endTime: string
  roomId: string | null
  teacherUserId: string | null
  effectiveFrom: string
  effectiveTo: string | null
}

export function slotDraftsOf(slots: readonly ScheduleSlot[]): SlotDraft[] {
  return slots.map((slot) => ({
    key: slot.id,
    id: slot.id,
    weekday: slot.weekday,
    startTime: slot.startTime,
    endTime: slot.endTime,
    roomId: slot.room?.id ?? null,
    teacherUserId: slot.teacher?.userId ?? null,
    effectiveFrom: slot.effectiveFrom,
    effectiveTo: slot.effectiveTo,
  }))
}

export function newSlotDraft(key: string, defaults: Partial<Pick<SlotDraft, 'weekday' | 'effectiveFrom'>> = {}): SlotDraft {
  return {
    key,
    weekday: defaults.weekday ?? null,
    startTime: '',
    endTime: '',
    roomId: null,
    teacherUserId: null,
    effectiveFrom: defaults.effectiveFrom ?? '',
    effectiveTo: null,
  }
}

export type SlotField = 'weekday' | 'startTime' | 'endTime' | 'effectiveFrom' | 'effectiveTo'
export type SlotProblem =
  | 'weekday_required'
  | 'non_working_day'
  | 'start_required'
  | 'end_required'
  | 'end_after_start'
  | 'from_required'
  | 'to_invalid'
  | 'to_not_before_from'
export type SlotProblems = Partial<Record<SlotField, SlotProblem>>

/** Problems of one row on its own (what the DTO and D-R28 would refuse); empty when it is complete and valid. */
export function slotProblems(draft: SlotDraft, workingDays: readonly number[] | null): SlotProblems {
  const problems: SlotProblems = {}
  if (draft.weekday === null) problems.weekday = 'weekday_required'
  else if (workingDays !== null && !workingDays.includes(draft.weekday)) problems.weekday = 'non_working_day'
  if (!isClockTime(draft.startTime)) problems.startTime = 'start_required'
  if (!isClockTime(draft.endTime)) problems.endTime = 'end_required'
  else if (isClockTime(draft.startTime) && clockMinutes(draft.endTime) <= clockMinutes(draft.startTime)) problems.endTime = 'end_after_start'
  if (!isCalendarDate(draft.effectiveFrom)) problems.effectiveFrom = 'from_required'
  if (draft.effectiveTo !== null) {
    if (!isCalendarDate(draft.effectiveTo)) problems.effectiveTo = 'to_invalid'
    else if (isCalendarDate(draft.effectiveFrom) && draft.effectiveTo < draft.effectiveFrom) problems.effectiveTo = 'to_not_before_from'
  }
  return problems
}

/** True when every required value is present and well-formed (working days aside). */
export function isComplete(draft: SlotDraft): draft is SlotDraft & { weekday: number } {
  return Object.keys(slotProblems(draft, null)).length === 0
}

export type DraftConflictKind = 'room' | 'teacher'

export interface DraftConflict {
  kind: DraftConflictKind
  /** Indexes in the list of the two rows that overlap (first < second). */
  first: number
  second: number
}

function draftsOverlap(a: SlotDraft, b: SlotDraft): boolean {
  return (
    a.weekday === b.weekday &&
    clockRangesOverlap(a.startTime, a.endTime, b.startTime, b.endTime) &&
    dateRangesOverlap(a.effectiveFrom, a.effectiveTo, b.effectiveFrom, b.effectiveTo)
  )
}

/**
 * The first pair of complete rows that book the same room, or the same
 * teacher, at overlapping times — mirror of `findRequestConflict()`; rows
 * without a room (or teacher) never conflict on that resource.
 */
export function findDraftConflict(drafts: readonly SlotDraft[]): DraftConflict | null {
  for (let second = 1; second < drafts.length; second += 1) {
    const b = drafts[second]!
    if (!isComplete(b)) continue
    for (let first = 0; first < second; first += 1) {
      const a = drafts[first]!
      if (!isComplete(a) || !draftsOverlap(a, b)) continue
      if (a.roomId !== null && a.roomId === b.roomId) return { kind: 'room', first, second }
      if (a.teacherUserId !== null && a.teacherUserId === b.teacherUserId) return { kind: 'teacher', first, second }
    }
  }
  return null
}

export interface DraftListProblems {
  /** Row problems by row key. */
  rows: Map<string, SlotProblems>
  conflict: DraftConflict | null
  tooMany: boolean
}

/** Everything that blocks saving; null when the list would be accepted as far as the client can tell. */
export function draftListProblems(drafts: readonly SlotDraft[], workingDays: readonly number[] | null): DraftListProblems | null {
  const rows = new Map<string, SlotProblems>()
  for (const draft of drafts) {
    const problems = slotProblems(draft, workingDays)
    if (Object.keys(problems).length > 0) rows.set(draft.key, problems)
  }
  const conflict = findDraftConflict(drafts)
  const tooMany = drafts.length > SCHEDULE_SLOTS_MAX
  return rows.size > 0 || conflict !== null || tooMany ? { rows, conflict, tooMany } : null
}

/** The body row of a complete draft (`id` only for a kept slot). */
export function toSlotInput(draft: SlotDraft): ScheduleSlotInput {
  return {
    ...(draft.id !== undefined ? { id: draft.id } : {}),
    weekday: draft.weekday ?? 0,
    startTime: draft.startTime,
    endTime: draft.endTime,
    roomId: draft.roomId,
    teacherUserId: draft.teacherUserId,
    effectiveFrom: draft.effectiveFrom,
    effectiveTo: draft.effectiveTo,
  }
}

/** True when the draft holds exactly the stored values of the slot. */
export function sameSlot(slot: ScheduleSlot, draft: SlotDraft): boolean {
  return (
    slot.weekday === draft.weekday &&
    slot.startTime === draft.startTime &&
    slot.endTime === draft.endTime &&
    (slot.room?.id ?? null) === draft.roomId &&
    (slot.teacher?.userId ?? null) === draft.teacherUserId &&
    slot.effectiveFrom === draft.effectiveFrom &&
    slot.effectiveTo === draft.effectiveTo
  )
}

/** The PUT body, or null when the drafts are the stored slots unchanged (in any order). */
export function planScheduleReplacement(current: readonly ScheduleSlot[], drafts: readonly SlotDraft[]): ReplaceClassScheduleInput | null {
  const byId = new Map(current.map((slot) => [slot.id, slot]))
  const seen = new Set<string>()
  const unchanged =
    drafts.length === current.length &&
    drafts.every((draft) => {
      if (draft.id === undefined || seen.has(draft.id)) return false
      seen.add(draft.id)
      const slot = byId.get(draft.id)
      return slot !== undefined && sameSlot(slot, draft)
    })
  return unchanged ? null : { slots: drafts.map(toSlotInput) }
}

/** The slots by weekday in the given order, weekdays without slots left out (the server's order inside a day is kept). */
export function groupByWeekday<T extends { weekday: number }>(slots: readonly T[], order: readonly number[]): { weekday: number; slots: T[] }[] {
  return order.map((weekday) => ({ weekday, slots: slots.filter((slot) => slot.weekday === weekday) })).filter((group) => group.slots.length > 0)
}
