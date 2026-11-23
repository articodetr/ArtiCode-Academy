// The timer of an attempt at an online exam (MOD-09 phase 2 — D-R152): pure
// math, unit-tested in takeExam.clock.test.ts.
//
// **The time is the server's.** The deadline is fixed on the server when the
// attempt starts; every answer about the attempt (API-276, API-277, API-278)
// says how many whole seconds are left at its own clock (`remainingSeconds`).
// The page remembers that number together with the moment it arrived on the
// device's MONOTONIC clock (`performance.now()`) and shows
// `remaining − elapsed`. The wall clock (`Date.now()`) and `expiresAt` are
// never used to decide the time left: a device clock can be wrong by hours,
// or be changed in the middle of an exam.
//
// What a sample is worth: the server rounds the time left UP to a whole second,
// and the answer travelled for some part of the round trip, so a sample read at
// its arrival says at most `round trip + 1 s` more than is really left — never
// less. Each sample is therefore an upper bound, and the tightest one wins:
// a later answer that says LESS than the running clock is adopted at once; one
// that says a little MORE (within what its own round trip and the rounding
// explain) changes nothing, so the display never jumps back up after a slow
// request; one that says clearly more means the running clock had fallen
// behind the server, and the server's word is taken.
//
// No React, no i18next instance.

/** The device's monotonic clock, in milliseconds. It never jumps when the device's date or zone is changed. */
export function monotonicNow(): number {
  return performance.now()
}

/** What one server answer says about the time left. */
export interface ClockSample {
  /** `remainingSeconds` of the answer: whole seconds left at the server's clock. */
  remainingSeconds: number
  /** The monotonic moment the request left this device. */
  sentAt: number
  /** The monotonic moment its answer arrived. */
  receivedAt: number
}

/** The running clock: `remainingSeconds` were left at the monotonic moment `at`. */
export interface ClockSync {
  remainingSeconds: number
  at: number
}

/** Under five minutes the timer turns to a calm warning. */
export const WARNING_SECONDS = 5 * 60
/** Under one minute, to a stronger one. */
export const CRITICAL_SECONDS = 60
/** The server rounds the time left up to a whole second. */
const ROUNDING_MS = 1000

function wholeSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

/** Milliseconds left at the monotonic moment `now` — never negative. */
export function remainingMs(sync: ClockSync, now: number): number {
  return Math.max(0, sync.remainingSeconds * 1000 - Math.max(0, now - sync.at))
}

/** Whole seconds to show at `now`: the server's number for the first second after its answer, 0 once the time is over. */
export function secondsLeft(sync: ClockSync, now: number): number {
  return Math.ceil(remainingMs(sync, now) / 1000)
}

/** True once the running clock has reached zero. */
export function isTimeOver(sync: ClockSync, now: number): boolean {
  return remainingMs(sync, now) <= 0
}

/** The running clock after one more server answer (see the header: the tightest upper bound wins). */
export function syncClock(previous: ClockSync | null, sample: ClockSample): ClockSync {
  const fresh: ClockSync = { remainingSeconds: wholeSeconds(sample.remainingSeconds), at: sample.receivedAt }
  if (previous === null) return fresh
  // What the running clock shows at the moment the answer arrived — below zero once it ran out.
  const runningMs = previous.remainingSeconds * 1000 - (sample.receivedAt - previous.at)
  const freshMs = fresh.remainingSeconds * 1000
  if (freshMs <= runningMs) return fresh
  // The answer says more than the running clock: its own round trip and the rounding explain that much.
  const explainedMs = Math.max(0, sample.receivedAt - sample.sentAt) + ROUNDING_MS
  return freshMs - runningMs <= explainedMs ? previous : fresh
}

export type ClockLevel = 'normal' | 'warning' | 'critical' | 'over'

/** How the timer looks: calm above five minutes, a warning under five, a stronger one under one, over at zero. */
export function clockLevel(seconds: number): ClockLevel {
  if (seconds <= 0) return 'over'
  if (seconds < CRITICAL_SECONDS) return 'critical'
  if (seconds < WARNING_SECONDS) return 'warning'
  return 'normal'
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

/** `mm:ss`, or `h:mm:ss` from one hour up — Latin digits, read left to right. */
export function formatClock(seconds: number): string {
  const total = wholeSeconds(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = `${twoDigits(minutes)}:${twoDigits(total % 60)}`
  return hours > 0 ? `${hours}:${rest}` : rest
}

/**
 * The minutes a screen reader is told: the time left rounded up to a whole minute, so the text changes once a
 * minute — at 5:00 it becomes «5», at 1:00 «1» (the two warning thresholds) — and 0 once the time is over.
 */
export function spokenMinutes(seconds: number): number {
  return Math.ceil(wholeSeconds(seconds) / 60)
}

/** The two device clocks read at one tick of the timer. */
export interface ClockMark {
  /** `performance.now()`. */
  monotonic: number
  /** `Date.now()` — read ONLY to notice that the two clocks disagree, never to compute the time left. */
  wall: number
}

/** A disagreement above this between the two clocks over one tick asks the server again. */
export const CLOCK_DISAGREEMENT_MS = 2000

/**
 * True when the monotonic and the wall clock disagree about how long it has been since the previous tick: the device
 * slept (some browsers pause the monotonic clock while it does) or its date was changed. Neither clock is trusted
 * then — the page reads the attempt again and takes the server's `remainingSeconds`.
 */
export function clocksDisagree(previous: ClockMark, current: ClockMark, toleranceMs = CLOCK_DISAGREEMENT_MS): boolean {
  return Math.abs(current.wall - previous.wall - (current.monotonic - previous.monotonic)) > toleranceMs
}

// --- When an answer arrived --------------------------------------------------------------------------------------

const arrivals = new WeakMap<object, number>()

/**
 * Remembers the monotonic moment a server value arrived (the attempt in progress of a «my exams» row), so a countdown
 * shown later starts from that moment and not from when its row happened to be drawn.
 */
export function markArrival(value: object, at: number = monotonicNow()): void {
  arrivals.set(value, at)
}

/** The moment recorded by markArrival(), or null for a value that was never marked. */
export function arrivalOf(value: object): number | null {
  return arrivals.get(value) ?? null
}
