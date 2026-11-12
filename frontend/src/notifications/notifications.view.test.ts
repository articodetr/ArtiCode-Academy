import { describe, expect, it } from 'vitest'
import { NOTIFIED_CHILD, NOTIFIED_STUDENT, makeAnnouncementNotification, makeMyNotification } from '../test/myNotifications'
import {
  DEFAULT_MY_NOTIFICATIONS_FILTERS,
  INBOX_LINK,
  KNOWN_NOTIFICATION_LINKS,
  aboutStudent,
  isNarrowed,
  isUnread,
  leadsElsewhere,
  myNotificationsQuery,
  notificationLink,
} from './notifications.view'

describe('notifications.view', () => {
  it('turns the filters into the API-167 query: unread only when set, the category, the cursor', () => {
    expect(myNotificationsQuery(DEFAULT_MY_NOTIFICATIONS_FILTERS)).toEqual({ unread: undefined, category: undefined, cursor: undefined })
    expect(myNotificationsQuery({ unread: true, category: 'finance' }, 'c-1')).toEqual({ unread: true, category: 'finance', cursor: 'c-1' })
    expect(isNarrowed(DEFAULT_MY_NOTIFICATIONS_FILTERS)).toBe(false)
    expect(isNarrowed({ unread: true })).toBe(true)
    expect(isNarrowed({ unread: false, category: 'exams' })).toBe(true)
  })

  it('reads unread from readAt alone', () => {
    expect(isUnread(makeMyNotification())).toBe(true)
    expect(isUnread(makeMyNotification({ readAt: '2026-11-12T10:00:00.000Z' }))).toBe(false)
  })

  it('follows every link the engine writes, and any other in-app path of the same shape', () => {
    for (const link of KNOWN_NOTIFICATION_LINKS) expect(notificationLink(makeMyNotification({ data: { link } }))).toBe(link)
    expect(notificationLink(makeMyNotification({ data: { link: '/my-attendance' } }))).toBe('/my-attendance')
  })

  it('refuses anything that is not an in-app path: a scheme, a host, a query, a backslash, a missing link', () => {
    for (const link of ['https://evil.test/x', '//evil.test', '/my-lessons?x=1', '/\\evil.test', 'javascript:alert(1)', 'my-lessons', '/', '/My-Lessons', '/a--b']) {
      expect(notificationLink(makeMyNotification({ data: { link } }))).toBeNull()
    }
    expect(notificationLink(makeMyNotification({ data: {} }))).toBeNull()
    expect(notificationLink(makeMyNotification({ data: { link: 42 } }))).toBeNull()
  })

  it('opens another page for an event and stays on the inbox for an announcement', () => {
    expect(leadsElsewhere(makeMyNotification())).toBe(true)
    expect(leadsElsewhere(makeAnnouncementNotification())).toBe(false)
    expect(notificationLink(makeAnnouncementNotification())).toBe(INBOX_LINK)
    expect(leadsElsewhere(makeMyNotification({ data: {} }))).toBe(false)
  })

  it('names the child of a guardian, never the viewer, an announcement or a class event about several children', () => {
    expect(aboutStudent(makeMyNotification({ student: NOTIFIED_CHILD }), 'guardian-1')).toEqual(NOTIFIED_CHILD)
    expect(aboutStudent(makeMyNotification({ student: NOTIFIED_STUDENT }), NOTIFIED_STUDENT.id)).toBeNull()
    expect(aboutStudent(makeAnnouncementNotification(), 'guardian-1')).toBeNull()
    expect(aboutStudent(makeMyNotification({ student: null, data: { link: '/my-lessons', studentIds: ['a', 'b'] } }), 'guardian-1')).toBeNull()
  })
})
