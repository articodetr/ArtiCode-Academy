// In-memory holder for the short-lived access token (MOD-01). It is never
// written to localStorage/sessionStorage: a page reload starts with no token
// and the refresh cookie (httpOnly, set by the server) restores the session.
import type { SessionResponse } from '../api/client'

let accessToken: string | null = null
/** Id of the user the access token belongs to; null when unknown or signed out (KI-046). */
let sessionUserId: string | null = null

type Listener = () => void
type SessionListener = (session: SessionResponse) => void
const sessionLostListeners = new Set<Listener>()
const sessionSwitchedListeners = new Set<SessionListener>()

export function getAccessToken(): string | null {
  return accessToken
}

export function getSessionUserId(): string | null {
  return sessionUserId
}

/** Stores the token and the id of its user; a null token forgets both. */
export function setAccessToken(token: string | null, userId: string | null = null): void {
  accessToken = token
  sessionUserId = token === null ? null : userId
}

/** Fired by the API client when a refresh fails, i.e. the session is gone. */
export function onSessionLost(listener: Listener): () => void {
  sessionLostListeners.add(listener)
  return () => sessionLostListeners.delete(listener)
}

export function emitSessionLost(): void {
  accessToken = null
  sessionUserId = null
  for (const listener of sessionLostListeners) listener()
}

/**
 * Fired by the API client when a refresh returns a session of ANOTHER user:
 * the refresh cookie is shared by every tab of the browser, so signing in as
 * someone else in one tab hands that account to the others (KI-046).
 */
export function onSessionSwitched(listener: SessionListener): () => void {
  sessionSwitchedListeners.add(listener)
  return () => sessionSwitchedListeners.delete(listener)
}

export function emitSessionSwitched(session: SessionResponse): void {
  for (const listener of sessionSwitchedListeners) listener(session)
}
