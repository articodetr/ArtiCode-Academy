// HTTP client for the backend. Paths include the backend prefix (/api/...).
// Adds the in-memory access token, sends cookies (refresh token) and, on a
// 401 caused by an expired/invalid access token, refreshes once and retries.
import {
  emitSessionLost,
  emitSessionSwitched,
  getAccessToken,
  getSessionUserId,
  setAccessToken,
} from '../auth/token-store'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

/** Backend error codes that mean "get a new access token and try again". */
const RETRY_CODES = new Set(['token_expired', 'token_invalid', 'unauthenticated'])

/**
 * Client-side code of the error thrown instead of a retry when the refreshed
 * session belongs to another user (KI-046): a request is never replayed on
 * behalf of someone other than the user who made it.
 */
export const SESSION_SWITCHED = 'session_switched'

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown
  /** Stable machine-readable code from the backend (auth errors), if any. */
  readonly code: string | null
  /** Seconds the server asked to wait before trying again (a 429's Retry-After), or null when it named none. */
  readonly retryAfterSeconds: number | null

  constructor(status: number, message: string, body?: unknown, retryAfterSeconds: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.code = codeFrom(body)
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/**
 * True for the server's own "there is no session" answer to a refresh: a 401
 * (refresh_missing | refresh_invalid | refresh_expired | refresh_reused |
 * session_invalid). Anything else — a 429 (the refresh limit is counted per IP,
 * and a school network shares one), a network error, a 5xx — says nothing
 * about the cookie, which may well still be valid.
 */
export function isSessionRejected(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

export function apiUrl(path: string): string {
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * The wait a response asks for, in whole seconds: the standard `Retry-After`
 * (seconds or an HTTP date), else the header @nestjs/throttler names after the
 * blocking throttler — the academy's is `login`, so a 429 carries `Retry-After-login`.
 */
function retryAfterFrom(headers: Headers): number | null {
  for (const name of ['Retry-After', 'Retry-After-login']) {
    const value = headers.get(name)?.trim()
    if (!value) continue
    if (/^\d+$/.test(value)) return Number(value)
    const at = Date.parse(value)
    if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000))
  }
  return null
}

function codeFrom(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'code' in body) {
    const { code } = body as { code: unknown }
    if (typeof code === 'string') return code
  }
  return null
}

function messageFrom(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body as { message: unknown }
    if (typeof message === 'string') return message
    if (Array.isArray(message)) return message.join(', ')
  }
  return fallback
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** JSON-serialised request body. */
  body?: unknown
  signal?: AbortSignal
  /** Attach the access token (default true). Public endpoints may pass false. */
  auth?: boolean
  /** Internal: prevents a second refresh-and-retry cycle. */
  retry?: boolean
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  return response.json().catch(() => undefined)
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, auth = true, retry = true } = options
  const headers = new Headers({ Accept: 'application/json' })
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const token = auth ? getAccessToken() : null
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(apiUrl(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    credentials: 'include',
  })
  const payload = await parseBody(response)

  if (response.ok) return payload as T

  const error = new ApiError(
    response.status,
    messageFrom(payload, `${response.status} ${response.statusText}`),
    payload,
    retryAfterFrom(response.headers),
  )
  if (auth && retry && response.status === 401 && error.code && RETRY_CODES.has(error.code)) {
    const requestedBy = getSessionUserId()
    const refreshed = await refreshSession().catch((refreshError: unknown) => {
      // The session is gone: the request's own 401 stands (and refreshSession() announced the loss).
      if (isSessionRejected(refreshError)) return null
      // Rate-limited, unreachable or a server error: the session is kept, so say what actually happened.
      throw refreshError
    })
    if (refreshed) {
      if (requestedBy !== null && refreshed.user.id !== requestedBy) {
        throw new ApiError(401, 'The session now belongs to another user', {
          statusCode: 401,
          code: SESSION_SWITCHED,
          message: 'The session now belongs to another user',
        })
      }
      return apiRequest<T>(path, { ...options, retry: false })
    }
  }
  throw error
}

export function apiGet<T>(path: string, init?: Pick<RequestInit, 'signal'>): Promise<T> {
  return apiRequest<T>(path, { method: 'GET', signal: init?.signal ?? undefined })
}

/** Mirrors backend/src/auth/auth.dto.ts AuthUserDto (API-005..API-010). */
export interface SessionUser {
  id: string
  email: string | null
  username: string | null
  fullName: string
  displayName: string | null
  locale: string | null
  status: string
  mustChangePassword: boolean
  roles: string[]
  permissions: string[]
  /** When the user confirmed their current address (CH-0226); null while unconfirmed. Absent from an older server. */
  emailVerifiedAt?: string | null
}

export interface SessionResponse {
  tokenType: 'Bearer'
  accessToken: string
  expiresIn: number
  user: SessionUser
}

/**
 * Name of the Web Lock that serialises refreshes across the tabs of the
 * browser (MOD-01-H08, KI-047). Every tab sends the same refresh cookie, and
 * the server treats a cookie it has already rotated as stolen and revokes the
 * whole session. Under the lock a tab sends its request only after the
 * previous tab's response has stored the new cookie.
 */
export const REFRESH_LOCK_NAME = 'articode.auth.refresh'

function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  // Missing outside a secure context (plain-HTTP origins other than localhost)
  // and in old browsers: refresh without the lock, as before H08.
  const locks: LockManager | undefined = globalThis.navigator?.locks
  return locks ? locks.request(REFRESH_LOCK_NAME, task) : task()
}

let refreshInFlight: Promise<SessionResponse> | null = null

/**
 * Rotates the refresh cookie and stores the new access token. Concurrent
 * callers in this tab share one request; requests from other tabs wait for it
 * (REFRESH_LOCK_NAME). Throws (and announces a lost session) when the
 * cookie is missing, expired, reused or the account is no longer usable.
 * Any other failure (429, network, 5xx) is thrown WITHOUT announcing a lost
 * session: the cookie may still be valid (isSessionRejected()).
 * Announces a switched session when the cookie now belongs to another user
 * than the stored token did (another tab signed in as someone else — KI-046).
 */
export function refreshSession(): Promise<SessionResponse> {
  if (!refreshInFlight) {
    refreshInFlight = withRefreshLock(() =>
      apiRequest<SessionResponse>('/api/auth/refresh', { method: 'POST', auth: false, retry: false }),
    )
      .then((session) => {
        const previousUserId = getSessionUserId()
        setAccessToken(session.accessToken, session.user.id)
        if (previousUserId !== null && previousUserId !== session.user.id) emitSessionSwitched(session)
        return session
      })
      .catch((error: unknown) => {
        if (isSessionRejected(error)) emitSessionLost()
        throw error
      })
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}
