// The current time for the calendar's "now" line and the upcoming list (J-F08):
// epoch ms, refreshed every `intervalMs` (a minute by default).
import { useEffect, useState } from 'react'

export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
