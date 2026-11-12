import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { makePreferences } from '../test/notificationPreferences'
import { getNotificationPreferences, updateNotificationPreferences } from './notificationPreferences'

describe('notification preferences API (API-171/172)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('reads the six switches with the Bearer token', async () => {
    const preferences = makePreferences({ emailVerified: false })
    const fetchMock = mockFetch(() => jsonResponse(200, preferences))

    await expect(getNotificationPreferences()).resolves.toEqual(preferences)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/me/notification-preferences')
    expect(init?.method ?? 'GET').toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
  })

  it('replaces the named categories with a PUT of JSON booleans and answers the six', async () => {
    const answer = makePreferences({}, ['finance'])
    const fetchMock = mockFetch(() => jsonResponse(200, answer))

    await expect(updateNotificationPreferences({ categories: [{ category: 'finance', emailEnabled: false }] })).resolves.toEqual(answer)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/me/notification-preferences')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({ categories: [{ category: 'finance', emailEnabled: false }] })
  })
})
