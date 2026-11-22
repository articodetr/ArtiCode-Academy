// MOD-09 phase 2 (OEX-T07) — the ticking side of the exam timer, with fake
// timers and a monotonic clock the test drives by hand: the shown seconds
// follow the server's number and the monotonic clock, never the device's date.
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClockSync } from './takeExam.clock'
import { CLOCK_TICK_MS, useAttemptClock } from './useAttemptClock'

interface ProbeProps {
  sync: ClockSync | null
  active?: boolean
  onElapsed?: () => void
  onDisagreement?: () => void
}

function Probe({ sync, active = true, onElapsed, onDisagreement }: ProbeProps) {
  const seconds = useAttemptClock(sync, { active, onElapsed, onDisagreement })
  return <output data-testid="seconds">{seconds === null ? 'none' : seconds}</output>
}

/** The monotonic clock of the test: it moves only when the test says so. */
const monotonic = { now: 50_000 }

/** Both device clocks move on together by `ms`, one tick at a time. */
function pass(ms: number) {
  act(() => {
    for (let elapsed = 0; elapsed < ms; elapsed += CLOCK_TICK_MS) {
      monotonic.now += CLOCK_TICK_MS
      vi.advanceTimersByTime(CLOCK_TICK_MS)
    }
  })
}

const shown = () => screen.getByTestId('seconds').textContent

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-20T07:30:00.000Z'))
  monotonic.now = 50_000
  vi.spyOn(performance, 'now').mockImplementation(() => monotonic.now)
})

afterEach(() => {
  // The spy wraps the fake timers: take it off first, then put the real timers back.
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useAttemptClock', () => {
  it('shows the server’s number at once and counts it down with the monotonic clock', () => {
    render(<Probe sync={{ remainingSeconds: 90, at: 50_000 }} />)
    expect(shown()).toBe('90')
    pass(750)
    expect(shown()).toBe('90')
    pass(250)
    expect(shown()).toBe('89')
    pass(29_000)
    expect(shown()).toBe('60')
  })

  it('does not move when the device’s date is changed — forwards, backwards or by a day', () => {
    const onDisagreement = vi.fn()
    render(<Probe sync={{ remainingSeconds: 1800, at: 50_000 }} onDisagreement={onDisagreement} />)
    pass(10_000)
    expect(shown()).toBe('1790')
    expect(onDisagreement).not.toHaveBeenCalled()

    // The learner (or a time sync) sets the device's clock an hour ahead: not «30 minutes gone».
    vi.setSystemTime(new Date('2026-11-20T08:30:10.000Z'))
    pass(1_000)
    expect(shown()).toBe('1789')
    // …but the clocks disagree, so the page is told to ask the server again.
    expect(onDisagreement).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-11-19T07:00:00.000Z'))
    pass(1_000)
    expect(shown()).toBe('1788')
    expect(onDisagreement).toHaveBeenCalledTimes(2)
  })

  it('notices a sleep the monotonic clock did not count, and still shows nothing but its own count', () => {
    const onDisagreement = vi.fn()
    render(<Probe sync={{ remainingSeconds: 600, at: 50_000 }} onDisagreement={onDisagreement} />)
    pass(1_000)
    // Twenty minutes pass on the wall clock while the monotonic clock stood still.
    act(() => {
      vi.setSystemTime(Date.now() + 20 * 60_000)
      monotonic.now += CLOCK_TICK_MS
      vi.advanceTimersByTime(CLOCK_TICK_MS)
    })
    expect(onDisagreement).toHaveBeenCalledTimes(1)
    expect(shown()).toBe('599') // until the server answers; the page then re-synchronises
  })

  it('takes a new answer of the server the moment it arrives, without waiting for a tick', () => {
    const { rerender } = render(<Probe sync={{ remainingSeconds: 600, at: 50_000 }} />)
    pass(5_000)
    expect(shown()).toBe('595')
    // A save answered 20 s later by the device's count, and the server says only 500 s are left.
    monotonic.now += 15_000
    rerender(<Probe sync={{ remainingSeconds: 500, at: monotonic.now }} />)
    expect(shown()).toBe('500')
    pass(1_000)
    expect(shown()).toBe('499')
  })

  it('says when the time has run out — on every tick while it has — and never shows less than zero', () => {
    const onElapsed = vi.fn()
    render(<Probe sync={{ remainingSeconds: 2, at: 50_000 }} onElapsed={onElapsed} />)
    pass(1_750)
    expect(shown()).toBe('1')
    expect(onElapsed).not.toHaveBeenCalled()
    pass(250)
    expect(shown()).toBe('0')
    expect(onElapsed).toHaveBeenCalledTimes(1)
    pass(5_000)
    expect(shown()).toBe('0')
    expect(onElapsed.mock.calls.length).toBeGreaterThan(1)
  })

  it('stops ticking once answers are no longer taken, and has nothing to show without a clock', () => {
    const onElapsed = vi.fn()
    const { rerender } = render(<Probe sync={{ remainingSeconds: 3, at: 50_000 }} onElapsed={onElapsed} />)
    pass(1_000)
    expect(shown()).toBe('2')
    rerender(<Probe sync={{ remainingSeconds: 3, at: 50_000 }} active={false} onElapsed={onElapsed} />)
    pass(10_000)
    expect(onElapsed).not.toHaveBeenCalled()
    expect(shown()).toBe('2')

    rerender(<Probe sync={null} onElapsed={onElapsed} />)
    expect(shown()).toBe('none')
    pass(1_000)
    expect(onElapsed).not.toHaveBeenCalled()
  })

  it('catches up the moment a hidden tab is shown again (its timers were throttled)', () => {
    render(<Probe sync={{ remainingSeconds: 600, at: 50_000 }} />)
    pass(1_000)
    expect(shown()).toBe('599')
    // Five minutes in the background without a single tick.
    monotonic.now += 300_000
    vi.setSystemTime(Date.now() + 300_000)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(shown()).toBe('299')
  })
})
