// Google sign-in (PORTAL-04 — the shared contract B). `POST /api/auth/google/start` is public: no access token and no
// session refresh. The server answers the address of Google's consent page and sets the short-lived httpOnly cookie
// `aca_google` (state, nonce, PKCE verifier, return path), which apiRequest's `credentials: 'include'` lets the browser
// store; the page then leaves for Google. Google sends the visitor back to `GET /api/auth/google/callback`, which always
// answers a redirect to this app: `/auth/google/done?returnTo=…` with the session cookie set, `/login#google-mfa=…` for
// an account with two-step verification, or `/login?google=<code>&returnTo=…` when it did not work.
// 503 google_unavailable while Google is not configured on the server; 403 origin_forbidden; 429 rate_limited.
import { apiRequest } from './client'

export const GOOGLE_PATHS = {
  start: '/api/auth/google/start',
} as const

/** Body of `POST /api/auth/google/start`: a path of this site to come back to (the server's rule; anything else → `/`). */
export interface GoogleStartInput {
  returnTo?: string
}

/** Answer of `POST /api/auth/google/start`. */
export interface GoogleStartResponse {
  /** Google's authorization page (response_type=code, scope `openid email profile`, state, nonce, PKCE S256). */
  url: string
}

/** Client-side code of the error thrown when the server's answer is not an address this page may leave for. */
export const GOOGLE_URL_INVALID = 'google_url_invalid'

/** Google's authorization page is always served over `https:`; anything else (a `javascript:` URL) is never followed. */
export function isGoogleAuthorizationUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

/** Asks the server to start a Google sign-in; resolves to the address of Google's page, never followed here. */
export async function startGoogleSignIn(returnTo: string | null): Promise<string> {
  const body: GoogleStartInput = returnTo ? { returnTo } : {}
  const answer = await apiRequest<GoogleStartResponse>(GOOGLE_PATHS.start, { method: 'POST', body, auth: false, retry: false })
  const url = (answer as Partial<GoogleStartResponse> | undefined)?.url
  if (!isGoogleAuthorizationUrl(url)) throw new Error(GOOGLE_URL_INVALID)
  return url
}

/**
 * The browser's own navigation, behind one seam: the page leaves for Google with a full navigation (the server's cookie
 * must reach Google's redirect back). Tests replace `assign` — jsdom cannot navigate.
 */
export const browserNavigation = {
  assign(url: string): void {
    window.location.assign(url)
  },
}
