// The ticking side of an attempt's timer: given the running clock
// (takeExam.clock.ts — the server's `remainingSeconds` anchored on the
// monotonic clock), it returns the whole seconds to show now, re-reads the
// monotonic clock four times a second, tells the caller when the time has run
// out, and when the device's two clocks disagree (the device slept, or its
// date was changed) so that the server is asked again. The wall clock is read
// for that comparison only — never to compute the time left.
import { useEffect, useRef, useState } from 'react'
import { clocksDisagree, monotonicNow, remainingMs, secondsLeft } from './takeExam.clock'
import type { ClockMark, ClockSync } from './takeExam.clock'

/** Four ticks a second: the shown second is never more than a quarter of a second late. */
export const CLOCK_TICK_MS = 250

export interface AttemptClockOptions {
  /** False once the attempt takes no more answers on this page: the ticking stops. */
  active: boolean
  /** The running clock is at zero (called on every tick while it is — the session acts once). */
  onElapsed?: () => void
  /** The monotonic and the wall clock disagree about the last tick. */
  onDisagreement?: () => void
}

/** The whole seconds left to show, or null without a clock. */
export function useAttemptClock(sync: ClockSync | null, { active, onElapsed, onDisagreement }: AttemptClockOptions): number | null {
  // The monotonic moment of the last tick; an answer of the server newer than it shows its own number until the next.
  const [tickedAt, setTickedAt] = useState(() => monotonicNow())
  const handlers = useRef({ onElapsed, onDisagreement })
  useEffect(() => {
    handlers.current = { onElapsed, onDisagreement }
  })

  useEffect(() => {
    if (sync === null || !active) return
    let mark: ClockMark = { monotonic: monotonicNow(), wall: Date.now() }
    const tick = () => {
      const current: ClockMark = { monotonic: monotonicNow(), wall: Date.now() }
      if (clocksDisagree(mark, current)) handlers.current.onDisagreement?.()
      mark = current
      // Re-render only when the shown second changes.
      setTickedAt((previous) => (secondsLeft(sync, Math.max(previous, sync.at)) === secondsLeft(sync, current.monotonic) ? previous : current.monotonic))
      if (remainingMs(sync, current.monotonic) <= 0) handlers.current.onElapsed?.()
    }
    const timer = window.setInterval(tick, CLOCK_TICK_MS)
    // A background tab's timers are throttled: catch up the moment it is shown again.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [sync, active])

  return sync === null ? null : secondsLeft(sync, Math.max(tickedAt, sync.at))
}
