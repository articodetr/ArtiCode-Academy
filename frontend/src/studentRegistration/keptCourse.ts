// The course a visitor chose before registering (the agreed contract v2 in GitHub #207: no `next` on the server). The
// e-mailed link may open much later, so the choice waits on this device: ONLY the course id and when it was kept, under
// its own key, for 48 hours. Never a name, an address or a token. An id must look like the server's (a UUID), so a crafted
// return path cannot put anything else in storage. Storage may be blocked: every access is guarded, and without it the
// visitor simply reaches the sign-in page. Nothing here enrolls.
import { enrollIntentCourseOf, returnPathOf } from '../auth/returnPath'

export const KEPT_COURSE_KEY = 'articode.registration.course'
export const KEPT_COURSE_TTL_MS = 48 * 60 * 60 * 1000

const COURSE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The course of the enroll intent in a router state, when it names one that looks like a server id. */
export function chosenCourseOf(state: unknown): string | null {
  const courseId = enrollIntentCourseOf(returnPathOf(state))
  return courseId !== null && COURSE_ID.test(courseId) ? courseId : null
}

export function clearKeptCourse(): void {
  try {
    window.localStorage.removeItem(KEPT_COURSE_KEY)
  } catch {
    // Storage is blocked: there is nothing to clear.
  }
}

export function keepCourse(courseId: string, now: number = Date.now()): void {
  if (!COURSE_ID.test(courseId)) return
  try {
    window.localStorage.setItem(KEPT_COURSE_KEY, JSON.stringify({ courseId, savedAt: now }))
  } catch {
    // Storage is blocked or full: the visitor reaches the sign-in page without the course.
  }
}

/**
 * After the server took a registration: keeps the course of this visit, or clears an older choice when this visit named
 * none, so one person's course is never offered to the next person registering on a shared device.
 */
export function rememberChosenCourse(state: unknown, now: number = Date.now()): void {
  const courseId = chosenCourseOf(state)
  if (courseId) keepCourse(courseId, now)
  else clearKeptCourse()
}

function parse(raw: string, now: number): string | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { courseId, savedAt } = value as { courseId?: unknown; savedAt?: unknown }
  if (typeof courseId !== 'string' || !COURSE_ID.test(courseId)) return null
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null
  const age = now - savedAt
  return age >= 0 && age < KEPT_COURSE_TTL_MS ? courseId : null
}

/** The kept course while it is valid; an expired or unreadable value is removed. */
export function readKeptCourse(now: number = Date.now()): string | null {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(KEPT_COURSE_KEY)
  } catch {
    return null
  }
  if (raw === null) return null
  const courseId = parse(raw, now)
  if (courseId === null) clearKeptCourse()
  return courseId
}

/** The kept course, once: it is removed as it is used. */
export function takeKeptCourse(now: number = Date.now()): string | null {
  const courseId = readKeptCourse(now)
  clearKeptCourse()
  return courseId
}
