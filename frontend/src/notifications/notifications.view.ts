// Pure rules of «my notifications» (J-F54 — MOD-12-T07): the filters of the
// page and their API-167 query, where a notification leads (`data.link`), and
// whose name a row shows. No React, no i18n — unit-tested in
// notifications.view.test.ts.
import type { ListMyNotificationsParams, MyNotification, NotificationCategory } from '../api/myNotifications'

/** The page's filters: unread only or all, and one category or all (the server ANDs them). */
export interface MyNotificationsFilters {
  unread: boolean
  category?: NotificationCategory
}

export const DEFAULT_MY_NOTIFICATIONS_FILTERS: MyNotificationsFilters = { unread: false }

/** How many notifications the bell's panel shows. */
export const BELL_PANEL_SIZE = 5

/** The API-167 parameters of the filters: `unread` only when set (the literal `true`); the server's page size of 20. */
export function myNotificationsQuery(filters: MyNotificationsFilters, cursor?: string): ListMyNotificationsParams {
  return { unread: filters.unread ? true : undefined, category: filters.category, cursor }
}

export function isNarrowed(filters: MyNotificationsFilters): boolean {
  return filters.unread || filters.category !== undefined
}

export function isUnread(item: Pick<MyNotification, 'readAt'>): boolean {
  return item.readAt === null
}

/**
 * The frontend paths the engine writes (NOTIFICATION_LINKS of backend/src/notifications/notifications.events.ts —
 * keep in sync). A link of the same shape that is not in the list (a later event) is followed too: it is an
 * in-app path, and a screen this build lacks opens the not-found page.
 */
export const KNOWN_NOTIFICATION_LINKS = ['/my-lessons', '/my-assignments', '/my-exams', '/my-grades', '/my-certificates', '/my-invoices', '/notifications'] as const

/** The inbox itself: an announcement has no page of its own, so its notification points here. */
export const INBOX_LINK = '/notifications'

/** An in-app path: lower-case segments of letters, digits and dashes — never a scheme, a host (`//…`), a query or a backslash. */
const IN_APP_PATH = /^(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/

/** Where a notification leads: its `data.link` when it is an in-app path, else null (nothing to open). */
export function notificationLink(item: Pick<MyNotification, 'data'>): string | null {
  const link = item.data.link
  return typeof link === 'string' && IN_APP_PATH.test(link) ? link : null
}

/** A link to another page than the inbox: opening the notification navigates there. */
export function leadsElsewhere(item: Pick<MyNotification, 'data'>): boolean {
  const link = notificationLink(item)
  return link !== null && link !== INBOX_LINK
}

/**
 * The student a row names: the one the notification is about when it is not the viewer — a guardian's
 * child. The viewer's own notifications, announcements and class events about several children (whose body
 * names them) name nobody.
 */
export function aboutStudent(item: Pick<MyNotification, 'student'>, viewerId: string | undefined): MyNotification['student'] {
  return item.student && item.student.id !== viewerId ? item.student : null
}

/** Tag colours of the six categories. */
export const NOTIFICATION_CATEGORY_COLORS: Readonly<Record<NotificationCategory, string>> = {
  lessons: 'geekblue',
  assignments: 'blue',
  exams: 'purple',
  grades: 'green',
  finance: 'gold',
  announcements: 'magenta',
}
