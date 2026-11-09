// Loading of the timetable readings for the dates the calendar shows (J-F08;
// replaces J-F05's one-request-per-filter-set hook, moved from
// schedule/useSchedule.ts). A weekly slot is effective on a DATE (`on` of
// API-090/091), so every shown date is read on its own: the academy schedule
// once per date with that date's `weekday` (the answer holds exactly that
// day's slots), «my schedule» once per date (the answer holds every weekday;
// the date's own slots are kept). Since J-F18 (the owner's notes on PR #46):
// each answer is pinned the moment it arrives, so a slow date never holds the
// others back; answers are kept per request path until `reload`; a request the
// new inputs no longer ask is aborted while one they still ask keeps running,
// so nothing is ever sent twice; and a failure belongs to the inputs it
// happened under — when the shown requests change, every failure is forgotten
// and a failed date still shown is asked again (once per change, never in a
// loop). A disabled reading never calls the server. Access stays with the
// server: nothing here filters by permission or ownership.
import { useCallback, useEffect, useRef, useState } from 'react'
import { academySchedulePath, getAcademySchedule, getMySchedule, mySchedulePath } from '../api/timetable'
import type { AcademyScheduleParams } from '../api/timetable'
import { weekdayOf } from './timetable.dates'
import type { CalendarDate } from './timetable.dates'
import { entriesOfMine, entriesOn, entryOfSlot } from './timetable.model'
import type { TimetableEntry, TimetableMode } from './timetable.model'

/** The academy schedule's filters (API-090) besides the date. */
export type AcademyFilters = Omit<AcademyScheduleParams, 'on'>

/** The entries of one date: API-090 with `on` + that date's `weekday` + the filters, or API-091 with `on`. */
export async function loadDate(mode: TimetableMode, filters: AcademyFilters, date: CalendarDate, signal: AbortSignal): Promise<TimetableEntry[]> {
  const weekday = weekdayOf(date)
  if (mode === 'mine') {
    const answer = await getMySchedule({ on: date }, signal)
    return entriesOn(entriesOfMine(answer.items), date)
  }
  // The weekday filter names another day: the server would answer nothing.
  if (filters.weekday !== undefined && filters.weekday !== weekday) return []
  const answer = await getAcademySchedule({ ...filters, on: date, weekday }, signal)
  return entriesOn(answer.slots.map(entryOfSlot), date)
}

/**
 * One cache key per request — the path actually asked for, so the same
 * request is never sent twice (a weekday filter naming the date's own weekday
 * asks exactly what the unfiltered reading asked); a date the weekday filter
 * excludes asks nothing and shares one empty key.
 */
export function requestKey(mode: TimetableMode, filters: AcademyFilters, date: CalendarDate): string {
  if (mode === 'mine') return `mine|${mySchedulePath({ on: date })}`
  const weekday = weekdayOf(date)
  if (filters.weekday !== undefined && filters.weekday !== weekday) return `academy|skip|${date}`
  return `academy|${academySchedulePath({ ...filters, on: date, weekday })}`
}

interface Store {
  /** Every answer by request key, kept until `reload`. */
  results: ReadonlyMap<string, TimetableEntry[]>
  /** The failures under the current inputs, by request key (forgotten when the inputs change). */
  failures: ReadonlyMap<string, unknown>
}

const EMPTY_STORE: Store = { results: new Map(), failures: new Map() }

type Outcome = { entries: TimetableEntry[] } | { error: unknown }

/** The store with one more outcome: an answer is kept for good, a failure until the inputs change. */
function pin(store: Store, key: string, outcome: Outcome): Store {
  if ('error' in outcome) return { results: store.results, failures: new Map(store.failures).set(key, outcome.error) }
  const failures = new Map(store.failures)
  failures.delete(key)
  return { results: new Map(store.results).set(key, outcome.entries), failures }
}

/** A request still running. */
interface Flight {
  controller: AbortController
  /** The `reload` round it belongs to: a reload aborts every older request. */
  round: number
}

export interface TimetableData {
  /** The entries of every requested date that has been answered. */
  byDate: ReadonlyMap<CalendarDate, TimetableEntry[]>
  /** Requested dates still waiting for their answer. */
  pending: ReadonlySet<CalendarDate>
  /** True when a requested date failed; `error` is the first failure. */
  failed: boolean
  error: unknown
  /** Forgets every answer and failure and aborts what is running, so the shown dates are read again. */
  reload: () => void
}

const SKIPPED = '|skip|'
const NO_ENTRIES: TimetableEntry[] = []

export function useTimetable(mode: TimetableMode, filters: AcademyFilters, dates: readonly CalendarDate[], enabled: boolean): TimetableData {
  const [store, setStore] = useState<Store>(EMPTY_STORE)
  const [round, setRound] = useState(0)
  const requests = dates.map((date) => ({ date, key: requestKey(mode, filters, date) }))
  // A date the weekday filter excludes is empty at once: nothing to ask, nothing to wait for.
  const asked = enabled ? requests.filter(({ key }) => !key.includes(SKIPPED)) : []
  const inputs = asked.map(({ key }) => key).join(',')

  // A failure belongs to the inputs it happened under. When the shown requests
  // change (another week or day, a filter, the mode, enabled), every failure is
  // forgotten while rendering — React's "adjust state when an input changes",
  // so no render shows a failure of other inputs — and a failed date still
  // shown is asked again. Under unchanged inputs a failure stays until `reload`.
  const [inputsOfFailures, setInputsOfFailures] = useState(inputs)
  if (inputsOfFailures !== inputs) {
    setInputsOfFailures(inputs)
    setStore((current) => (current.failures.size === 0 ? current : { results: current.results, failures: new Map() }))
  }

  const missing = asked.filter(({ key }) => !store.results.has(key) && !store.failures.has(key))
  const missingKey = missing.map(({ key }) => key).join(',')
  // The request effect runs when the missing keys (or the reload round) change;
  // the keys name every input (mode, filters, dates), and it reads them from here.
  const latest = useRef({ mode, filters, missing })
  useEffect(() => {
    latest.current = { mode, filters, missing }
  })
  /** The requests still running, by key. */
  const flights = useRef(new Map<string, Flight>())

  useEffect(() => {
    const batch = latest.current
    const running = flights.current
    const wanted = new Set(batch.missing.map(({ key }) => key))
    // Abort what the inputs no longer ask (and whatever a reload replaced); what they still ask keeps running.
    for (const [key, flight] of running) {
      if (wanted.has(key) && flight.round === round) continue
      flight.controller.abort()
      running.delete(key)
    }
    for (const { date, key } of batch.missing) {
      if (running.has(key)) continue
      const controller = new AbortController()
      running.set(key, { controller, round })
      // Each date is pinned the moment its answer arrives: a slow date never holds the others back.
      const settle = (outcome: Outcome) => {
        if (running.get(key)?.controller === controller) running.delete(key)
        if (!controller.signal.aborted) setStore((current) => pin(current, key, outcome))
      }
      void loadDate(batch.mode, batch.filters, date, controller.signal).then(
        (entries) => settle({ entries }),
        (error: unknown) => settle({ error }),
      )
    }
  }, [missingKey, round])

  // Unmounting aborts whatever is still running.
  useEffect(() => {
    const running = flights.current
    return () => {
      for (const flight of running.values()) flight.controller.abort()
      running.clear()
    }
  }, [])

  const reload = useCallback(() => {
    setStore(EMPTY_STORE)
    setRound((value) => value + 1)
  }, [])

  const byDate = new Map<CalendarDate, TimetableEntry[]>()
  const pending = new Set<CalendarDate>()
  let failed = false
  let error: unknown = null
  for (const { date, key } of requests) {
    const result = key.includes(SKIPPED) ? NO_ENTRIES : store.results.get(key)
    if (result) byDate.set(date, result)
    else if (store.failures.has(key)) {
      if (!failed) error = store.failures.get(key)
      failed = true
    } else if (enabled) pending.add(date)
  }
  return { byDate, pending, failed, error, reload }
}
