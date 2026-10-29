// MOD-01 endpoints (backend/src/auth/auth.controller.ts).
import { setAccessToken } from '../auth/token-store'
import { apiRequest, refreshSession } from './client'
import type { SessionResponse, SessionUser } from './client'

export type { SessionResponse, SessionUser }
export { refreshSession }

export const AUTH_PATHS = {
  login: '/api/auth/login',
  refresh: '/api/auth/refresh',
  logout: '/api/auth/logout',
  logoutAll: '/api/auth/logout-all',
  me: '/api/auth/me',
  password: '/api/auth/password',
} as const

export async function login(identifier: string, password: string): Promise<SessionResponse> {
  const session = await apiRequest<SessionResponse>(AUTH_PATHS.login, {
    method: 'POST',
    body: { identifier, password },
    auth: false,
    retry: false,
  })
  setAccessToken(session.accessToken)
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
