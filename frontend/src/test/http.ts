import { vi } from 'vitest'
import type { SessionResponse } from '../api/client'

/** A JSON response as the backend sends it (`null` body for 204). */
export function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  })
}

export type FetchHandler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>

/**
 * Replaces the global `fetch` for the current test with a handler that gets the
 * URL string and the init object. Undone automatically (`test.unstubGlobals`).
 */
export function mockFetch(handler: FetchHandler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The body of POST /api/auth/login|refresh (API-005/API-006) for an academy admin. */
export function sessionResponse(
  accessToken = 'access-1',
  user: Partial<SessionResponse['user']> = {},
): SessionResponse {
  return {
    tokenType: 'Bearer',
    accessToken,
    expiresIn: 900,
    user: {
      id: 'user-1',
      email: 'admin@test.local',
      username: 'admin',
      fullName: 'مدير الأكاديمية',
      displayName: null,
      locale: 'ar',
      status: 'active',
      mustChangePassword: false,
      roles: ['academy_admin'],
      permissions: ['users.read', 'users.read_contact'],
      ...user,
    },
  }
}
