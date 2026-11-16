// MOD-01 endpoints (backend/src/auth/auth.controller.ts).
import { setAccessToken } from '../auth/token-store'
import { apiRequest, refreshSession } from './client'
import type { SessionResponse, SessionUser } from './client'

export type { SessionResponse, SessionUser }
export { refreshSession }

export const AUTH_PATHS = {
  login: '/api/auth/login',
  loginMfa: '/api/auth/login/mfa',
  refresh: '/api/auth/refresh',
  logout: '/api/auth/logout',
  logoutAll: '/api/auth/logout-all',
  me: '/api/auth/me',
  password: '/api/auth/password',
} as const

/**
 * Mirrors backend/src/auth/auth.dto.ts MfaChallengeResponseDto: what API-005 (a
 * correct password) and API-020 (a confirmed reset) answer for an account with
 * two-step verification instead of a session. No cookie came with it; the
 * sign-in finishes with API-211 (`completeMfaLogin`). The challenge lives five
 * minutes, allows five wrong codes and works once — keep it in memory only.
 */
export interface MfaChallenge {
  mfaRequired: true
  challenge: string
  /** ISO 8601 */
  expiresAt: string
}

/** The one second factor of API-211: the authenticator's current code, or an unused recovery code. */
export type MfaFactor = { code: string } | { recoveryCode: string }

/** True for the challenge answer, false for an issued session (the server's `isPendingMfa`). */
export function isMfaChallenge(value: unknown): value is MfaChallenge {
  return typeof value === 'object' && value !== null && (value as { mfaRequired?: unknown }).mfaRequired === true
}

/**
 * API-005. A session (its access token is stored), or for an account with
 * two-step verification the challenge of the second step — then nothing is
 * stored and nobody is signed in yet.
 */
export async function login(identifier: string, password: string): Promise<SessionResponse | MfaChallenge> {
  const result = await apiRequest<SessionResponse | MfaChallenge>(AUTH_PATHS.login, {
    method: 'POST',
    body: { identifier, password },
    auth: false,
    retry: false,
  })
  if (isMfaChallenge(result)) return result
  setAccessToken(result.accessToken, result.user.id)
  return result
}

/**
 * API-211, public: the second step of a sign-in. Consumes the challenge and
 * opens the session exactly like `login()`. 401 mfa_code_invalid (the challenge
 * stays usable until its fifth wrong code), 401 mfa_challenge_invalid (start
 * again with the password), 423 account_locked, 429 rate_limited, 503 mfa_unavailable.
 */
export async function completeMfaLogin(challenge: string, factor: MfaFactor): Promise<SessionResponse> {
  const session = await apiRequest<SessionResponse>(AUTH_PATHS.loginMfa, {
    method: 'POST',
    body: 'code' in factor ? { challenge, code: factor.code } : { challenge, recoveryCode: factor.recoveryCode },
    auth: false,
    retry: false,
  })
  setAccessToken(session.accessToken, session.user.id)
  return session
}

/** Revokes the refresh cookie's session; never throws on an already-gone session. */
export async function logout(): Promise<void> {
  try {
    await apiRequest<void>(AUTH_PATHS.logout, { method: 'POST', auth: false, retry: false })
  } finally {
    setAccessToken(null)
  }
}

export async function logoutAll(): Promise<void> {
  try {
    await apiRequest<void>(AUTH_PATHS.logoutAll, { method: 'POST' })
  } finally {
    setAccessToken(null)
  }
}

export function fetchMe(signal?: AbortSignal): Promise<SessionUser> {
  return apiRequest<SessionUser>(AUTH_PATHS.me, { signal })
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return apiRequest<void>(AUTH_PATHS.password, { method: 'POST', body: { currentPassword, newPassword } })
}
