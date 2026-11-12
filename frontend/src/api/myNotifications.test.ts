import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { NOTIFICATION_ID, makeMyNotification, makeMyNotificationList } from '../test/myNotifications'
import {
  NOTIFICATION_CATEGORIES,
  getUnreadCount,
  isNotificationCategory,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  myNotificationsPath,
} from './myNotifications'

describe('my notifications API (API-167..API-170)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('lists the six categories in the server order', () => {
    expect(NOTIFICATION_CATEGORIES).toEqual(['lessons', 'assignments', 'exams', 'grades', 'finance', 'announcements'])
    expect(isNotificationCategory('finance')).toBe(true)
    expect(isNotificationCategory('reminders')).toBe(false)
  })

  it('builds the list path with the given parameters only, `unread` as the literal true', () => {
    expect(myNotificationsPath()).toBe('/api/me/notifications')
    expect(myNotificationsPath({ unread: false, category: undefined, cursor: '' })).toBe('/api/me/notifications')
    expect(myNotificationsPath({ cursor: NOTIFICATION_ID, limit: 5, category: 'finance', unread: true })).toBe(
      `/api/me/notifications?unread=true&category=finance&limit=5&cursor=${NOTIFICATION_ID}`,
    )
  })

  it('reads the inbox and the unread count with the Bearer token and the abort signal', async () => {
    const list = makeMyNotificationList([makeMyNotification()], 'next-1')
    const fetchMock = mockFetch((url) => (url.endsWith('unread-count') ? jsonResponse(200, { unread: 3 }) : jsonResponse(200, list)))
    const controller = new AbortController()

    await expect(listMyNotifications({ category: 'assignments' }, controller.signal)).resolves.toEqual(list)
    await expect(getUnreadCount(controller.signal)).resolves.toEqual({ unread: 3 })

    const [listUrl, listInit] = fetchMock.mock.calls[0]!
    expect(listUrl).toBe('/api/me/notifications?category=assignments')
    expect(listInit?.method ?? 'GET').toBe('GET')
    expect(new Headers(listInit?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(listInit?.signal).toBe(controller.signal)
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/me/notifications/unread-count')
  })

  it('marks one notification read and answers the notification as the server returned it', async () => {
    const answer = makeMyNotification({ readAt: '2026-11-12T10:00:00.000Z' })
    const fetchMock = mockFetch(() => jsonResponse(200, answer))

    await expect(markNotificationRead(NOTIFICATION_ID)).resolves.toEqual(answer)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/api/me/notifications/${NOTIFICATION_ID}/read`)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
  })

  it('marks everything read without a body, or one category with { category }', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { updated: 2 }))

    await expect(markAllNotificationsRead()).resolves.toEqual({ updated: 2 })
    await markAllNotificationsRead('finance')

    const [allUrl, allInit] = fetchMock.mock.calls[0]!
    expect(allUrl).toBe('/api/me/notifications/read-all')
    expect(allInit?.method).toBe('POST')
    expect(allInit?.body).toBeUndefined()
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ category: 'finance' })
  })

  it('rejects with the server code of a refusal', async () => {
    mockFetch(() => jsonResponse(404, { statusCode: 404, code: 'notification_not_found', notificationId: NOTIFICATION_ID }))
    await expect(markNotificationRead(NOTIFICATION_ID)).rejects.toMatchObject({ status: 404, code: 'notification_not_found' })
  })
})
