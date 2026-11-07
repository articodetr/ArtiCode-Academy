// Loading of the timetable readings for the dates the calendar shows (J-F08;
// replaces J-F05's one-request-per-filter-set hook, moved from
// schedule/useSchedule.ts). A weekly slot is effective on a DATE (`on` of
// API-090/091), so every shown date is read on its own: the academy schedule
// once per date with that date's `weekday` (the answer holds exactly that
// day's slots), «my schedule» once per date (the answer holds every weekday;
// the date's own slots are kept). Answers are kept per (mode, filters, date)
// until `reload`; a batch still running when the inputs change is aborted
// (its dates are asked again while still shown); a disabled reading never
// calls the server. Access stays with the server: nothing here filters by
// permission or ownership.
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
  results: ReadonlyMap<string, TimetableEntry[]>
  errors: ReadonlyMap<string, unknown>
}

const EMPTY_STORE: Store = { results: new Map(), errors: new Map() }

export interface TimetableData {
  /** The entries of every requested date that has been answered. */
  byDate: ReadonlyMap<CalendarDate, TimetableEntry[]>
  /** Requested dates still waiting for their answer. */
  pending: ReadonlySet<CalendarDate>
  /** True when a requested date failed; `error` is the first failure. */
  failed: boolean
  error: unknown
  /** Forgets every answer and failure, so the shown dates are read again. */
  reload: () => void
}

const SKIPPED = '|skip|'
const NO_ENTRIES: TimetableEntry[] = []

export function useTimetable(mode: TimetableMode, filters: AcademyFilters, dates: readonly CalendarDate[], enabled: boolean): TimetableData {
  const [store, setStore] = useState<Store>(EMPTY_STORE)
  const requests = dates.map((date) => ({ date, key: requestKey(mode, filters, date) }))
  // A date the weekday filter excludes is empty at once: nothing to ask, nothing to wait for.
  const missing = enabled ? requests.filter(({ key }) => !key.includes(SKIPPED) && !store.results.has(key) && !store.errors.has(key)) : []
  const missingKey = missing.map(({ key }) => key).join(',')
  // The batch effect runs when the missing keys change; the keys name every input
  // (mode, filters, dates), and the batch reads them from here.
  const latest = useRef({ mode, filters, missing })
  useEffect(() => {
    latest.current = { mode, filters, missing }
  })

  useEffect(() => {
    const batch = latest.current
    if (batch.missing.length === 0) return
    const controller = new AbortController()
    void Promise.allSettled(batch.missing.map(({ date }) => loadDate(batch.mode, batch.filters, date, controller.signal))).then((outcomes) => {
      if (controller.signal.aborted) return
      setStore((current) => {
        const results = new Map(current.results)
        const errors = new Map(current.errors)
        outcomes.forEach((outcome, index) => {
          const key = batch.missing[index]!.key
          if (outcome.status === 'fulfilled') results.set(key, outcome.value)
          else errors.set(key, outcome.reason)
        })
        return { results, errors }
      })
    })
    return () => controller.abort()
  }, [missingKey])

  const reload = useCallback(() => setStore(EMPTY_STORE), [])

  const byDate = new Map<CalendarDate, TimetableEntry[]>()
  const pending = new Set<CalendarDate>()
  let failed = false
  let error: unknown = null
  for (const { date, key } of requests) {
    const result = key.includes(SKIPPED) ? NO_ENTRIES : store.results.get(key)
    if (result) byDate.set(date, result)
    else if (store.errors.has(key)) {
      if (!failed) error = store.errors.get(key)
      failed = true
    } else if (enabled) pending.add(date)
  }
  return { byDate, pending, failed, error, reload }
}
