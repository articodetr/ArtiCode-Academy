// Pure rules of the class sessions shown in «My School» and the course player
// (MOD-20 — D-R143): which sessions are still ahead and which are behind, and
// how the learner's own attendance reads. Every value is the server's (API-229
// `nextSession`, API-230 `sessions`, API-231 `sessions`): nothing is joined or
// recorded here. Unit-tested in learn.sessions.test.ts.
import type { Translate } from '../users/users.format'

export const SESSION_STATUS_COLORS: Readonly<Record<string, string>> = { scheduled: 'blue', completed: 'green', cancelled: 'default' }
export const KNOWN_SESSION_STATUSES: ReadonlySet<string> = new Set(['scheduled', 'completed', 'cancelled'])
const KNOWN_ATTENDANCE = new Set(['present', 'late', 'absent', 'excused'])

interface Timed {
  startsAt: string
  endsAt: string
}

function instant(iso: string): number {
  const value = Date.parse(iso)
  return Number.isNaN(value) ? 0 : value
}

/**
 * The sessions still ahead (not ended at `now` — a session running now is
 * ahead), the soonest first, and those behind, the most recent first: the
 * sidebar lists what is coming before what is done.
 */
export function splitSessions<T extends Timed>(sessions: readonly T[], now: number = Date.now()): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = []
  const past: T[] = []
  for (const session of sessions) (instant(session.endsAt) > now ? upcoming : past).push(session)
  upcoming.sort((a, b) => instant(a.startsAt) - instant(b.startsAt))
  past.sort((a, b) => instant(b.startsAt) - instant(a.startsAt))
  return { upcoming, past }
}

/** True while the session runs (started, not ended). */
export function isSessionLive(session: Timed, now: number = Date.now()): boolean {
  return instant(session.startsAt) <= now && now < instant(session.endsAt)
}

/**
 * The learner's own attendance as a sentence, or null when there is nothing
 * to say: a recorded status by name (lateness in minutes), «not recorded yet»
 * for a session that already started, nothing for one still to come or
 * cancelled.
 */
export function attendanceTextOf(
  session: Timed & { status: string; attendance: { status: string; minutesLate: number | null } | null },
  t: Translate,
  now: number = Date.now(),
): string | null {
  if (session.status === 'cancelled') return null
  const attendance = session.attendance
  if (attendance && KNOWN_ATTENDANCE.has(attendance.status)) {
    return attendance.status === 'late' && typeof attendance.minutesLate === 'number'
      ? t('learn.live.lateBy', { minutes: attendance.minutesLate })
      : t(`learn.live.attendance.${attendance.status}`)
  }
  return instant(session.startsAt) <= now ? t('learn.live.noAttendance') : null
}
