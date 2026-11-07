// The calendar's view of the two timetable readings (J-F08), pure and
// unit-tested in timetable.model.test.ts. API-090 slots and API-091 items
// both become one `TimetableEntry` per weekly slot: «my schedule» answers one
// item per slot × relation, which the calendar shows as ONE card naming every
// relation (two children in one class = one card with both names). An entry
// is a recurring weekly slot, never a confirmed lesson (roadmap §4e.1: dated
// lessons are MOD-06), so it occurs on a date only when the date falls on its
// weekday inside `effectiveFrom`..`effectiveTo` (inclusive, open end).
import type { MyScheduleItem, MyScheduleRelation, MyScheduleStudent, ScheduleClass, ScheduleRoom, TimetableSlot } from '../api/timetable'
import { clockMinutes, weekdayOf, zonedInstant } from './timetable.dates'
import type { CalendarDate } from './timetable.dates'

export type TimetableMode = 'academy' | 'mine'

/** Why «my schedule» shows a slot: as student (`self`), through a linked child, or as its teacher. */
export interface EntryRelation {
  relation: MyScheduleRelation
  /** The enrolled student for `self` and `child`; null for `teacher`. */
  student: MyScheduleStudent | null
}

export interface TimetableEntry {
  /** The slot id — one entry per weekly slot. */
  id: string
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  /** `HH:MM` in `timeZone`. */
  startTime: string
  endTime: string
  /** Minutes since midnight, for the grid. */
  startMinutes: number
  endMinutes: number
  /** IANA zone the times are read in (the room's branch, else the academy's). */
  timeZone: string
  effectiveFrom: CalendarDate
  effectiveTo: CalendarDate | null
  class: ScheduleClass
  room: ScheduleRoom | null
  /** By name; null = the slot names no teacher (the class's lead teacher teaches it). */
  teacher: { fullName: string; displayName: string | null } | null
  /** «My schedule» only, in the server's order (`self` → `child` → `teacher`); empty for the academy schedule. */
  relations: EntryRelation[]
}

export function entryOfSlot(slot: TimetableSlot): TimetableEntry {
  return {
    id: slot.id,
    weekday: slot.weekday,
    startTime: slot.startTime,
    endTime: slot.endTime,
    startMinutes: clockMinutes(slot.startTime),
    endMinutes: clockMinutes(slot.endTime),
    timeZone: slot.timeZone,
    effectiveFrom: slot.effectiveFrom,
    effectiveTo: slot.effectiveTo,
    class: slot.class,
    room: slot.room,
    teacher: slot.teacher ? { fullName: slot.teacher.fullName, displayName: null } : null,
    relations: [],
  }
}

/** One entry per slot, its relations collected in the server's order without repeats. */
export function entriesOfMine(items: readonly MyScheduleItem[]): TimetableEntry[] {
  const bySlot = new Map<string, TimetableEntry>()
  for (const item of items) {
    let entry = bySlot.get(item.id)
    if (!entry) {
      entry = {
        id: item.id,
        weekday: item.weekday,
        startTime: item.startTime,
        endTime: item.endTime,
        startMinutes: clockMinutes(item.startTime),
        endMinutes: clockMinutes(item.endTime),
        timeZone: item.timeZone,
        effectiveFrom: item.effectiveFrom,
        effectiveTo: item.effectiveTo,
        class: item.class,
        room: item.room,
        teacher: item.teacher,
        relations: [],
      }
      bySlot.set(item.id, entry)
    }
    const studentId = item.student?.id ?? null
    if (!entry.relations.some((known) => known.relation === item.relation && (known.student?.id ?? null) === studentId)) {
      entry.relations.push({ relation: item.relation, student: item.student })
    }
  }
  return [...bySlot.values()]
}

/** True when the weekly slot recurs on `date`: its weekday, inside its effective range (inclusive, open end). */
export function occursOn(entry: Pick<TimetableEntry, 'weekday' | 'effectiveFrom' | 'effectiveTo'>, date: CalendarDate): boolean {
  return weekdayOf(date) === entry.weekday && entry.effectiveFrom <= date && (entry.effectiveTo === null || date <= entry.effectiveTo)
}

/** Start time, then end time, then class code, then id — the order of a day's cards. */
export function compareEntries(a: TimetableEntry, b: TimetableEntry): number {
  return a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes || a.class.code.localeCompare(b.class.code) || a.id.localeCompare(b.id)
}

/** The entries that occur on `date`, in display order. */
export function entriesOn(entries: readonly TimetableEntry[], date: CalendarDate): TimetableEntry[] {
  return entries.filter((entry) => occursOn(entry, date)).sort(compareEntries)
}

/** One dated occurrence of a weekly slot (for the upcoming list) — a projection, not a lesson. */
export interface Occurrence {
  entry: TimetableEntry
  date: CalendarDate
  /** Epoch ms, in the slot's own zone. */
  startsAt: number
  endsAt: number
}

/**
 * The occurrences on `dates` that have not ended at `now`, soonest first
 * (instants computed in each slot's own zone, so slots of branches in other
 * zones sort correctly), at most `limit`.
 */
export function upcomingOccurrences(
  entriesByDate: ReadonlyMap<CalendarDate, readonly TimetableEntry[]>,
  dates: readonly CalendarDate[],
  now: number,
  limit: number,
): Occurrence[] {
  const occurrences: Occurrence[] = []
  for (const date of dates) {
    for (const entry of entriesByDate.get(date) ?? []) {
      if (!occursOn(entry, date)) continue
      const endsAt = zonedInstant(date, entry.endTime, entry.timeZone)
      if (endsAt <= now) continue
      occurrences.push({ entry, date, startsAt: zonedInstant(date, entry.startTime, entry.timeZone), endsAt })
    }
  }
  return occurrences.sort((a, b) => a.startsAt - b.startsAt || a.endsAt - b.endsAt || compareEntries(a.entry, b.entry)).slice(0, limit)
}

/** The pastel tones of the cards (timetable.css `tt-tone-0..3`). */
export const TONE_COUNT = 4

/** A stable tone per key (the course id): one course keeps its colour across the week. */
export function toneOf(key: string): number {
  let hash = 0
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0
  return hash % TONE_COUNT
}
