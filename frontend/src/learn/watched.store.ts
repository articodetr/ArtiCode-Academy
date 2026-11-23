// How much of a YouTube lesson this learner has watched on this device (J-F64).
// API-233 measures a file video or an audio lesson only (`playback_not_tracked`
// for YouTube — D-R134), so the played intervals of a YouTube lesson are kept in
// the browser, per user and lesson. This is a display of the learner's own
// viewing, never the record: a lesson is complete only when the server says so
// (API-234 — D-R133). Storage can be missing or refuse a write (a private
// window): the bar then simply lasts as long as the page.
import { useSyncExternalStore } from 'react'
import type { PlayedRange } from '../api/learning'
import { mergeRanges } from './usePlaybackTracker'

const KEY_PREFIX = 'articode.watched.v1'
/** A learner who skips around can create many intervals; the longest ones are kept. */
const RANGES_MAX = 200
/** A position this close to the end starts the video over instead of resuming on its last seconds. */
const RESUME_END_MARGIN_SECONDS = 5

export interface WatchedEntry {
  ranges: PlayedRange[]
  positionSeconds: number
  durationSeconds: number | null
}

export interface WatchedChange {
  /** Intervals played since the previous write. */
  ranges?: readonly PlayedRange[]
  positionSeconds?: number
  durationSeconds?: number | null
}

const memory = new Map<string, WatchedEntry | null>()
const listeners = new Set<() => void>()

function keyOf(userId: string, itemId: string): string {
  return `${KEY_PREFIX}:${userId}:${itemId}`
}

function isRange(value: unknown): value is PlayedRange {
  return Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part) && part >= 0) && value[1] > value[0]
}

function parsedEntry(raw: string | null): WatchedEntry | null {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const record = value as Record<string, unknown>
    if (!Array.isArray(record.ranges)) return null
    const position = record.positionSeconds
    const duration = record.durationSeconds
    return {
      ranges: mergeRanges(record.ranges.filter(isRange)),
      positionSeconds: typeof position === 'number' && Number.isFinite(position) && position >= 0 ? position : 0,
      durationSeconds: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : null,
    }
  } catch {
    return null
  }
}

function storedEntry(key: string): WatchedEntry | null {
  try {
    return parsedEntry(window.localStorage.getItem(key))
  } catch {
    return null
  }
}

export function readWatched(userId: string, itemId: string): WatchedEntry | null {
  const key = keyOf(userId, itemId)
  if (memory.has(key)) return memory.get(key) ?? null
  const entry = storedEntry(key)
  memory.set(key, entry)
  return entry
}

function capped(ranges: PlayedRange[]): PlayedRange[] {
  if (ranges.length <= RANGES_MAX) return ranges
  return mergeRanges([...ranges].sort((a, b) => b[1] - b[0] - (a[1] - a[0])).slice(0, RANGES_MAX))
}

/** Adds what was played to the stored entry; the union only grows. Returns the entry as it now stands. */
export function writeWatched(userId: string, itemId: string, change: WatchedChange): WatchedEntry {
  const key = keyOf(userId, itemId)
  // Read again: another tab may have added to the entry since this page last looked, and its part must not be lost.
  const held = memory.get(key) ?? null
  const stored = storedEntry(key)
  const entry: WatchedEntry = {
    ranges: capped(mergeRanges([...(held?.ranges ?? []), ...(stored?.ranges ?? []), ...(change.ranges ?? [])])),
    positionSeconds: change.positionSeconds ?? stored?.positionSeconds ?? held?.positionSeconds ?? 0,
    durationSeconds: change.durationSeconds ?? stored?.durationSeconds ?? held?.durationSeconds ?? null,
  }
  memory.set(key, entry)
  try {
    window.localStorage.setItem(key, JSON.stringify(entry))
  } catch {
    // Full or blocked storage: the entry stays in memory for this page.
  }
  listeners.forEach((listener) => listener())
  return entry
}

export function coveredSeconds(ranges: readonly PlayedRange[]): number {
  return mergeRanges(ranges).reduce((total, [start, end]) => total + (end - start), 0)
}

/** The watched share, floored; null while the video's length is unknown. */
export function watchedPercentOf(entry: WatchedEntry | null): number | null {
  if (!entry || entry.durationSeconds === null) return null
  return Math.min(100, Math.floor((coveredSeconds(entry.ranges) / entry.durationSeconds) * 100))
}

/** Where the video reopens: the last position, unless it was at the very end. */
export function resumeSecondsOf(entry: WatchedEntry | null): number {
  if (!entry) return 0
  const { positionSeconds, durationSeconds } = entry
  if (durationSeconds !== null && positionSeconds >= durationSeconds - RESUME_END_MARGIN_SECONDS) return 0
  return positionSeconds
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab of the same browser moved a bar.
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(`${KEY_PREFIX}:`)) {
      memory.delete(event.key)
      listener()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** The watched percent of one lesson, following every write. */
export function useWatchedPercent(userId: string | undefined, itemId: string): number | null {
  return useSyncExternalStore(subscribe, () => (userId ? watchedPercentOf(readWatched(userId, itemId)) : null))
}

/** Test-only: forgets what was read from storage. */
export function resetWatchedMemory(): void {
  memory.clear()
}
