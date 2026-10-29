// In-memory holder for the short-lived access token (MOD-01). It is never
// written to localStorage/sessionStorage: a page reload starts with no token
// and the refresh cookie (httpOnly, set by the server) restores the session.

let accessToken: string | null = null

type Listener = () => void
const sessionLostListeners = new Set<Listener>()

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

/** Fired by the API client when a refresh fails, i.e. the session is gone. */
export function onSessionLost(listener: Listener): () => void {
  sessionLostListeners.add(listener)
  return () => sessionLostListeners.delete(listener)
}

export function emitSessionLost(): void {
  accessToken = null
  for (const listener of sessionLostListeners) listener()
}
