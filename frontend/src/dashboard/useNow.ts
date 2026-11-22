import { useEffect, useState } from 'react'

/** Ticks once a minute so the homes follow the clock (the learner's day, the staff's «today»). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}
