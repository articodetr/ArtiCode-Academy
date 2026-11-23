// MOD-09 phase 2 (OEX-T07) — the timer math of the exam page: the time left
// comes from the server's `remainingSeconds` and the device's MONOTONIC clock,
// never from the device's date.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLOCK_DISAGREEMENT_MS,
  arrivalOf,
  clockLevel,
  clocksDisagree,
  formatClock,
  isTimeOver,
  markArrival,
  monotonicNow,
  remainingMs,
  secondsLeft,
  spokenMinutes,
  syncClock,
} from './takeExam.clock'
import type { ClockSync } from './takeExam.clock'

/** A sample that arrived at `receivedAt` after a round trip of `roundTrip` ms. */
const sample = (remainingSeconds: number, receivedAt: number, roundTrip = 100) => ({ remainingSeconds, sentAt: receivedAt - roundTrip, receivedAt })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the time left (the server’s number and the monotonic clock)', () => {
  const sync: ClockSync = { remainingSeconds: 90, at: 10_000 }

  it('shows the server’s number for the first second after its answer, then counts down, and stops at zero', () => {
    expect(secondsLeft(sync, 10_000)).toBe(90)
    expect(secondsLeft(sync, 10_999)).toBe(90)
    expect(secondsLeft(sync, 11_000)).toBe(89)
    expect(secondsLeft(sync, 10_000 + 89_001)).toBe(1)
    expect(secondsLeft(sync, 10_000 + 90_000)).toBe(0)
    expect(isTimeOver(sync, 10_000 + 89_999)).toBe(false)
    expect(isTimeOver(sync, 10_000 + 90_000)).toBe(true)
  })

  it('is never negative, however long ago the time ran out', () => {
    expect(remainingMs(sync, 10_000 + 3_600_000)).toBe(0)
    expect(secondsLeft(sync, 10_000 + 3_600_000)).toBe(0)
    expect(Object.is(secondsLeft(sync, 10_000 + 3_600_000), -0)).toBe(false)
  })

  it('shows the server’s number, not more, when asked about a moment before the answer arrived', () => {
    expect(secondsLeft(sync, 4_000)).toBe(90)
  })

  it('reads the monotonic clock of the device, and never its date', () => {
    const date = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('the wall clock must not be read')
    })
    vi.spyOn(performance, 'now').mockReturnValue(123_456)
    expect(monotonicNow()).toBe(123_456)
    const first = syncClock(null, sample(1800, monotonicNow()))
    expect(secondsLeft(first, 123_456 + 60_000)).toBe(1740)
    expect(syncClock(first, sample(1700, 123_456 + 90_000))).toEqual({ remainingSeconds: 1700, at: 123_456 + 90_000 })
    expect(date).not.toHaveBeenCalled()
  })
})

describe('syncClock (each answer of the server is an upper bound; the tightest one wins)', () => {
  it('anchors the first answer at the moment it arrived', () => {
    expect(syncClock(null, sample(1800, 5_000, 400))).toEqual({ remainingSeconds: 1800, at: 5_000 })
  })

  it('takes whole, non-negative seconds only', () => {
    expect(syncClock(null, sample(-3, 0)).remainingSeconds).toBe(0)
    expect(syncClock(null, sample(12.9, 0)).remainingSeconds).toBe(12)
    expect(syncClock(null, sample(Number.NaN, 0)).remainingSeconds).toBe(0)
  })

  it('adopts at once an answer that says less than the running clock', () => {
    const first = syncClock(null, sample(600, 0, 2_500)) // a slow first answer: up to 3.5 s too generous
    // 10 s later the running clock shows 590; a quick answer says 587.
    const second = syncClock(first, sample(587, 10_000, 80))
    expect(second).toEqual({ remainingSeconds: 587, at: 10_000 })
    expect(secondsLeft(second, 10_000)).toBe(587)
  })

  it('keeps the running clock when a later answer says a little more — as much as its own round trip and the rounding explain', () => {
    const first = syncClock(null, sample(600, 0, 50))
    // 10 s later the running clock shows 590. A slow answer (3 s round trip) says 593: it left the server up to 3 s ago.
    const slow = syncClock(first, sample(593, 10_000, 3_000))
    expect(slow).toBe(first)
    expect(secondsLeft(slow, 10_000)).toBe(590)
    // The rounding alone (the server rounds up to a whole second): 591 after a quick trip changes nothing either.
    expect(syncClock(first, sample(591, 10_000, 20))).toBe(first)
  })

  it('takes the server’s word when it says clearly more than the running clock (the device’s clock ran ahead)', () => {
    const first = syncClock(null, sample(600, 0, 50))
    const corrected = syncClock(first, sample(640, 10_000, 100))
    expect(corrected).toEqual({ remainingSeconds: 640, at: 10_000 })
  })

  it('takes the server’s word when the running clock has run out but the server still counts time', () => {
    const first = syncClock(null, sample(5, 0, 50))
    // 9 s later the running clock is 4 s below zero; the server says 20 s are left.
    expect(syncClock(first, sample(20, 9_000, 100))).toEqual({ remainingSeconds: 20, at: 9_000 })
    // …and a zero from the server ends it whatever the running clock shows.
    expect(secondsLeft(syncClock({ remainingSeconds: 300, at: 0 }, sample(0, 1_000)), 1_000)).toBe(0)
  })

  it('never lets a string of slow answers push the time left up', () => {
    let clock = syncClock(null, sample(1800, 0, 100))
    for (let step = 1; step <= 20; step += 1) {
      // Every 30 s a save answers after a 2 s round trip, each time 2 s more generous than the truth.
      clock = syncClock(clock, sample(1800 - step * 30 + 2, step * 30_000, 2_000))
      expect(secondsLeft(clock, step * 30_000)).toBe(1800 - step * 30)
    }
  })
})

describe('how the timer looks and reads', () => {
  it('is calm above five minutes, warns under five, warns stronger under one, and is over at zero', () => {
    expect(clockLevel(3600)).toBe('normal')
    expect(clockLevel(300)).toBe('normal')
    expect(clockLevel(299)).toBe('warning')
    expect(clockLevel(60)).toBe('warning')
    expect(clockLevel(59)).toBe('critical')
    expect(clockLevel(1)).toBe('critical')
    expect(clockLevel(0)).toBe('over')
    expect(clockLevel(-5)).toBe('over')
  })

  it('formats mm:ss, and h:mm:ss from one hour', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(9)).toBe('00:09')
    expect(formatClock(59)).toBe('00:59')
    expect(formatClock(60)).toBe('01:00')
    expect(formatClock(1800)).toBe('30:00')
    expect(formatClock(3599)).toBe('59:59')
    expect(formatClock(3600)).toBe('1:00:00')
    expect(formatClock(3661)).toBe('1:01:01')
    expect(formatClock(12 * 3600)).toBe('12:00:00')
    expect(formatClock(-4)).toBe('00:00')
    expect(formatClock(Number.NaN)).toBe('00:00')
  })

  it('tells a screen reader whole minutes, rounded up — so the text changes once a minute and at 5:00 and 1:00', () => {
    expect(spokenMinutes(1800)).toBe(30)
    expect(spokenMinutes(1741)).toBe(30)
    expect(spokenMinutes(1740)).toBe(29)
    expect(spokenMinutes(301)).toBe(6)
    expect(spokenMinutes(300)).toBe(5)
    expect(spokenMinutes(61)).toBe(2)
    expect(spokenMinutes(60)).toBe(1)
    expect(spokenMinutes(1)).toBe(1)
    expect(spokenMinutes(0)).toBe(0)
  })
})

describe('clocksDisagree (when to ask the server again)', () => {
  const before = { monotonic: 1_000, wall: 1_700_000_000_000 }

  it('is quiet while both clocks agree about the last tick', () => {
    expect(clocksDisagree(before, { monotonic: 1_250, wall: before.wall + 250 })).toBe(false)
    expect(clocksDisagree(before, { monotonic: 61_000, wall: before.wall + 60_400 })).toBe(false) // a throttled tab: both moved a minute
    expect(clocksDisagree(before, { monotonic: 1_250, wall: before.wall + 250 + CLOCK_DISAGREEMENT_MS })).toBe(false)
  })

  it('notices a changed date (either way) and a sleep the monotonic clock did not count', () => {
    expect(clocksDisagree(before, { monotonic: 1_250, wall: before.wall + 3_600_000 })).toBe(true)
    expect(clocksDisagree(before, { monotonic: 1_250, wall: before.wall - 86_400_000 })).toBe(true)
    // The device slept 20 minutes: the wall clock moved on, the monotonic one did not.
    expect(clocksDisagree(before, { monotonic: 1_300, wall: before.wall + 1_200_000 })).toBe(true)
  })
})

describe('the moment a server value arrived', () => {
  it('remembers it by the value itself, and knows nothing about another one', () => {
    const inProgress = { id: 'a', remainingSeconds: 60 }
    expect(arrivalOf(inProgress)).toBeNull()
    markArrival(inProgress, 4_200)
    expect(arrivalOf(inProgress)).toBe(4_200)
    expect(arrivalOf({ ...inProgress })).toBeNull()
  })

  it('defaults to the monotonic clock', () => {
    vi.spyOn(performance, 'now').mockReturnValue(77)
    const value = {}
    markArrival(value)
    expect(arrivalOf(value)).toBe(77)
  })
})
