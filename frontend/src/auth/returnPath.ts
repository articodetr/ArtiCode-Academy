// Where a sign-in returns to (PORTAL-04, the learner journey — stage 2). A
// visitor who chose «سجّل في هذه الدورة» on the public course page reaches the
// login page with `from` = `/catalog/<id>?intent=enroll` in the router state
// (RequireAuth puts the same there for any protected page). These pure rules
// read that value back:
// - only a path of this site is ever followed: one leading `/`, never `//` or a
//   backslash (both lead to another host in a browser), no control character,
//   and the same origin once parsed — anything else is no return path at all;
// - `/login` itself is no destination (it would loop);
// - a user who must change the password goes to the profile page first and
//   carries the return path along, so the chosen course survives that step too;
// - the enroll intent names its course, for the login page's notice.
// Nothing here enrolls: the course page only shows the classes, and the learner
// chooses and confirms as always. No React, no I/O.
import type { AuthUser } from './auth-context'

/** A throwaway origin to resolve a relative path against: whatever leaves it is not a path of this site. */
const PROBE_ORIGIN = 'https://return-path.invalid'
const MAX_LENGTH = 2048

function hasUnsafeCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    // Control characters (a browser drops tabs and newlines inside a URL, so `/\t/evil` would become `//evil`) and the backslash.
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true
  }
  return false
}

/** The value as a path of this site (path, query and fragment), or null when it is not one. */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LENGTH) return null
  if (!value.startsWith('/') || value.startsWith('//') || hasUnsafeCharacter(value)) return null
  let url: URL
  try {
    url = new URL(value, PROBE_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== PROBE_ORIGIN || url.pathname === '/login') return null
  return `${url.pathname}${url.search}${url.hash}`
}

/** The return path of the router state (`{ from }`), checked; null without a usable one. */
export function returnPathOf(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null
  return safeReturnPath((state as { from?: unknown }).from)
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
