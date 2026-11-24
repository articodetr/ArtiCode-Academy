// Where a sign-in returns to (PORTAL-04, the learner journey). A visitor who chose «سجّل في هذه الدورة» on the public
// course page reaches the sign-in page with the course's path — as `?returnTo=` in the address, or as `from` in the
// router state (RequireAuth puts the path of any protected page there) — and Google's sign-in brings the same path
// back from the server (`/auth/google/done?returnTo=…`, `/login?google=…&returnTo=…`, the `#google-mfa=…` fragment).
// These pure rules read that value back:
// - the rule of the server for `returnTo` (POST /api/auth/google/start — the shared contract): at most 512 characters,
//   exactly one leading `/` (never `//` or `/\`, which lead to another host in a browser), no backslash, no whitespace
//   or control character (a browser drops tabs and newlines inside a URL, so `/\t/evil` would become `//evil`), and not
//   under `/api/`; a full URL is never one. Anything else is no return path at all;
// - on top of it, the same origin once parsed, and `/login` itself is no destination (it would loop);
// - after a sign-in: the return path when it names a page, else the course a visitor kept on this device while
//   registering (keptCourse.ts — for a student only), else the home page;
// - a user who must change the password goes to the profile page first and carries the destination along, so the
//   chosen course survives that step too;
// - the enroll intent names its course, for the sign-in page's notice.
// Nothing here enrolls: the course page only shows the classes, and the learner chooses and confirms as always.
// No React, no I/O.
import { enrollIntentPath } from '../publicCatalog/publicCatalog.view'
import type { AuthUser } from './auth-context'

/** A throwaway origin to resolve a relative path against: whatever leaves it is not a path of this site. */
const PROBE_ORIGIN = 'https://return-path.invalid'
/** The server's limit for `returnTo` (the shared contract, rule B). */
export const RETURN_PATH_MAX_LENGTH = 512
/** The query parameter that carries a return path between the public pages, the sign-in and the server. */
export const RETURN_TO_PARAM = 'returnTo'

const WHITESPACE = /\s/

function hasUnsafeCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    // Control characters and the backslash.
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true
  }
  return WHITESPACE.test(value)
}

/**
 * True when the value follows the server's rule for `returnTo`, character for character — the server answers `/` for
 * anything else, so the two sides always agree on what is a return path.
 */
export function followsReturnToRule(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > RETURN_PATH_MAX_LENGTH) return false
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return false
  if (value.startsWith('/api/')) return false
  return !hasUnsafeCharacter(value)
}

/** The value as a path of this site (path, query and fragment), or null when it is not one. */
export function safeReturnPath(value: unknown): string | null {
  if (!followsReturnToRule(value)) return null
  let url: URL
  try {
    url = new URL(value, PROBE_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== PROBE_ORIGIN || url.pathname === '/login' || url.pathname.startsWith('/api/')) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/** The return path of the router state (`{ from }`), checked; null without a usable one. */
export function returnPathOf(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null
  return safeReturnPath((state as { from?: unknown }).from)
}

/** The `?returnTo=` of a query string (`location.search`), checked; null without a usable one. */
export function returnToOf(search: string): string | null {
  return safeReturnPath(new URLSearchParams(search).get(RETURN_TO_PARAM))
}

/** The return path a page was opened with: `?returnTo=` first, else the router state's `from`. */
export function requestedReturnPath(search: string, state: unknown): string | null {
  return returnToOf(search) ?? returnPathOf(state)
}

/** True for a return path that names a page; the home page names none (it is where a sign-in goes anyway). */
export function namesAPage(path: string | null): path is string {
  return path !== null && path !== '/'
}

/** A link to `pathname` that carries the return path as `?returnTo=` — nothing for none or the home page. */
export function withReturnTo(pathname: string, returnTo: string | null): string {
  const safe = safeReturnPath(returnTo)
  return namesAPage(safe) ? `${pathname}?${RETURN_TO_PARAM}=${encodeURIComponent(safe)}` : pathname
}

/**
 * The course of an enroll intent — `/catalog/<id>?intent=enroll`, as `enrollIntentPath()` of
 * publicCatalog.view.ts writes it — else null.
 */
export function enrollIntentCourseOf(path: string | null): string | null {
  const safe = safeReturnPath(path)
  if (!safe) return null
  const url = new URL(safe, PROBE_ORIGIN)
  if (url.searchParams.get('intent') !== 'enroll') return null
  const match = /^\/catalog\/([^/]+)$/.exec(url.pathname)
  if (!match) return null
  try {
    return decodeURIComponent(match[1]!) || null
  } catch {
    return null
  }
}

export interface SignInDestination {
  path: string
  /** Router state for the destination: the return path the profile page continues to after the password change. */
  state?: { from: string }
}

/**
 * Where a user who has just signed in (or is signed in already) belongs: the profile page while the password must
 * be changed — carrying the return path, unless it is only the home page — else the return path, else the home page.
 */
export function signInDestination(user: Pick<AuthUser, 'mustChangePassword'>, from: string | null): SignInDestination {
  if (user.mustChangePassword) return from && from !== '/' ? { path: '/profile', state: { from } } : { path: '/profile' }
  return { path: from ?? '/' }
}

export interface SignInTarget extends SignInDestination {
  /**
   * The destination is the course kept on this device — by itself, or because the return path names that very course
   * (the public course page both keeps it and sends `?returnTo=`): the caller clears it, so it is offered once.
   */
  usesKeptCourse: boolean
}

/** The `student` role key: the only role that can enroll itself (API-221), so the only one a kept course is for. */
export function isStudent(user: Pick<AuthUser, 'roles'> | null | undefined): boolean {
  return user?.roles.includes('student') ?? false
}

/**
 * Where a sign-in leads — a password sign-in, Google's, or the second step of either: the return path when it names a
 * page; else, for a student, the course they kept on this device while registering (its enroll intent, which the
 * signed-in course page understands); else the existing default (`signInDestination`).
 */
export function signInTarget(
  user: Pick<AuthUser, 'mustChangePassword' | 'roles'>,
  returnTo: string | null,
  keptCourse: string | null,
): SignInTarget {
  if (namesAPage(returnTo)) {
    const sameCourse = keptCourse !== null && enrollIntentCourseOf(returnTo) === keptCourse
    return { ...signInDestination(user, returnTo), usesKeptCourse: sameCourse }
  }
  if (keptCourse && isStudent(user)) return { ...signInDestination(user, enrollIntentPath(keptCourse)), usesKeptCourse: true }
  return { ...signInDestination(user, returnTo), usesKeptCourse: false }
}
