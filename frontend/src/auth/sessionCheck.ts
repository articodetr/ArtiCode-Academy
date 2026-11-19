// The start-up session check of AuthProvider (CH-0296): POST /api/auth/refresh
// on page load. Only the server's "no session" answer (a 401 — isSessionRejected())
// makes the visitor anonymous; an answer that says nothing about the session is
// asked again a bounded number of times before the provider gives up and says so.
import { ApiError } from '../api/client'

/** How many times the check is sent again after a 429, a network error or a 5xx (four requests at most). */
export const SESSION_CHECK_RETRIES = 3

/** The waits when the server names none (a network error, a 5xx, a 429 without Retry-After). */
const BACKOFF_MS = [1_000, 2_000, 4_000] as const

/**
 * The longest single wait, whatever Retry-After says. The refresh limits count
 * per minute (30 per IP and cookie, 1200 per IP — D-R140), so a blocked visitor
 * is told at most 60 s; a retry after 30 s that is still blocked gets the rest
 * of that minute named again.
 */
export const MAX_RETRY_WAIT_MS = 30_000

/** Why the check could not tell, for the message shown after the last retry. */
export type SessionCheckProblem = 'rate_limited' | 'network' | 'server'

/** The wait before retry number `retry` (0-based): the server's Retry-After when it named one, else a back-off. */
export function sessionCheckDelay(error: unknown, retry: number): number {
  if (error instanceof ApiError && error.retryAfterSeconds !== null) {
    return Math.min(Math.max(error.retryAfterSeconds, 1) * 1000, MAX_RETRY_WAIT_MS)
  }
  return BACKOFF_MS[Math.min(retry, BACKOFF_MS.length - 1)]
}

/** A failure that is not an ApiError never reached the server (fetch rejected: offline, DNS, a proxy down). */
export function sessionCheckProblem(error: unknown): SessionCheckProblem {
  if (!(error instanceof ApiError)) return 'network'
  return error.status === 429 ? 'rate_limited' : 'server'
}
