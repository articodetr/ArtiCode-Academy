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

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.code = codeFrom(body)
  }
}

export function apiUrl(path: string): string {
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
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

  const error = new ApiError(response.status, messageFrom(payload, `${response.status} ${response.statusText}`), payload)
  if (auth && retry && response.status === 401 && error.code && RETRY_CODES.has(error.code)) {
    const requestedBy = getSessionUserId()
    const refreshed = await refreshSession().catch(() => null)
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
}

export interface SessionResponse {
  tokenType: 'Bearer'
  accessToken: string
  expiresIn: number
  user: SessionUser
}

let refreshInFlight: Promise<SessionResponse> | null = null

/**
 * Rotates the refresh cookie and stores the new access token. Concurrent
 * callers share one request. Throws (and announces a lost session) when the
 * cookie is missing, expired, reused or the account is no longer usable.
 * Announces a switched session when the cookie now belongs to another user
 * than the stored token did (another tab signed in as someone else — KI-046).
 */
export function refreshSession(): Promise<SessionResponse> {
  if (!refreshInFlight) {
    refreshInFlight = apiRequest<SessionResponse>('/api/auth/refresh', { method: 'POST', auth: false, retry: false })
      .then((session) => {
        const previousUserId = getSessionUserId()
        setAccessToken(session.accessToken, session.user.id)
        if (previousUserId !== null && previousUserId !== session.user.id) emitSessionSwitched(session)
        return session
      })
      .catch((error: unknown) => {
        emitSessionLost()
        throw error
      })
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}
