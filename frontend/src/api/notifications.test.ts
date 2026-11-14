import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { NOTIFICATION_ID, makeNotification, makeNotificationList, makePreferences } from '../test/notifications'
import {
  getNotificationPreferences,
  getUnreadCount,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  myNotificationsPath,
  updateNotificationPreferences,
} from './notifications'

describe('notifications API (API-167..API-172)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the inbox path with the given parameters only, in a fixed order', () => {
    expect(myNotificationsPath()).toBe('/api/me/notifications')
    expect(myNotificationsPath({ unread: false, category: undefined })).toBe('/api/me/notifications')
    expect(myNotificationsPath({ unread: true, category: 'finance', limit: 20, cursor: 'c%1' })).toBe('/api/me/notifications?unread=true&category=finance&limit=20&cursor=c%251')
  })

  it('reads and writes with the documented methods, paths and bodies', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith('/unread-count')) return jsonResponse(200, { unread: 3 })
      if (url.endsWith('/read-all')) return jsonResponse(200, { updated: 2 })
      if (url.includes('preferences')) return jsonResponse(200, makePreferences())
      if (url.endsWith('/read')) return jsonResponse(200, makeNotification({ readAt: '2026-11-14T10:00:00.000Z' }))
      return jsonResponse(200, makeNotificationList())
    })
    await listMyNotifications({ unread: true })
    await expect(getUnreadCount()).resolves.toEqual({ unread: 3 })
    await markNotificationRead(NOTIFICATION_ID)
    await markAllNotificationsRead()
    await markAllNotificationsRead('exams')
    await getNotificationPreferences()
    await updateNotificationPreferences([{ category: 'finance', emailEnabled: false }])
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['/api/me/notifications?unread=true', 'GET', undefined],
      ['/api/me/notifications/unread-count', 'GET', undefined],
      [`/api/me/notifications/${NOTIFICATION_ID}/read`, 'POST', undefined],
      ['/api/me/notifications/read-all', 'POST', '{}'],
      ['/api/me/notifications/read-all', 'POST', '{"category":"exams"}'],
      ['/api/me/notification-preferences', 'GET', undefined],
      ['/api/me/notification-preferences', 'PUT', '{"categories":[{"category":"finance","emailEnabled":false}]}'],
    ])
  })
})
