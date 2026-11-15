// The caller's signed-in devices (MOD-01-H06, CH-0272): API-201 lists the refresh-token families that are still
// alive, API-202 signs one of them out. No permission key; the refresh cookie (Path /api/auth) marks `current`.
import { apiRequest } from './client'

/** `SessionItemDto` (backend/src/auth/sessions.dto.ts). */
export interface SessionItem {
  /** The refresh-token family id (UUIDv7). */
  id: string
  startedAt: string
  lastActiveAt: string
  expiresAt: string
  userAgent: string | null
  ipAddress: string | null
  /** True for the session of this browser's refresh cookie. */
  current: boolean
}

export const SESSIONS_PATH = '/api/auth/sessions'

/** API-201: newest activity first. */
export function listSessions(signal?: AbortSignal): Promise<{ items: SessionItem[] }> {
  return apiRequest<{ items: SessionItem[] }>(SESSIONS_PATH, { signal })
}

/** API-202: 204; `404 session_not_found` when it is gone already. */
export function revokeSession(id: string): Promise<void> {
  return apiRequest<void>(`${SESSIONS_PATH}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
