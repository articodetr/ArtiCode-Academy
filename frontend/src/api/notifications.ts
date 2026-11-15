// «My notifications» and e-mail preferences (MOD-12-T02): API-167 GET
// /api/me/notifications, API-168 GET …/unread-count, API-169 POST …/:id/read,
// API-170 POST …/read-all, API-171/172 GET/PUT /api/me/notification-preferences.
// Types mirror backend/src/notifications/my-notifications.dto.ts. Every route
// works by ownership — no permission key. The title and body are worded by
// the server in the recipient's language when the notification was created.
import { apiRequest } from './client'

/** In the order of `NOTIFICATION_CATEGORIES` (notifications.events.ts); API-171 lists the six in this order. */
export const NOTIFICATION_CATEGORIES = ['lessons', 'assignments', 'exams', 'grades', 'finance', 'announcements'] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export const MY_NOTIFICATIONS_PAGE_MAX = 100

/** `NotificationStudentDto`: the student a notification is about (the caller or their child). */
export interface NotificationStudent {
  id: string
  fullName: string
  displayName: string | null
}

/** `MyNotificationDto`. */
export interface MyNotification {
  id: string
  /** `lesson.cancelled`, `submission.graded`, `invoice.issued`, `announcement` … */
  eventKey: string
  category: NotificationCategory
  title: string
  body: string
  /** `link` (a frontend path) and the ids of the event — never a name, a score or an amount. */
  data: Record<string, unknown>
  student: NotificationStudent | null
  announcementId: string | null
  /** ISO 8601; null while unread. */
  readAt: string | null
  createdAt: string
}

export interface MyNotificationList {
  items: MyNotification[]
  nextCursor: string | null
}

export interface ListMyNotificationsParams {
  /** true: only the unread ones. */
  unread?: boolean
  category?: NotificationCategory
  /** 1–100, server default 20. */
  limit?: number
  cursor?: string
}

/** `NotificationPreferenceDto`. */
export interface NotificationPreference {
  category: NotificationCategory
  emailEnabled: boolean
}

/** `NotificationPreferencesDto` (API-171/172). */
export interface NotificationPreferences {
  categories: NotificationPreference[]
  /** The caller confirmed an e-mail address — nothing is e-mailed without it. */
  emailVerified: boolean
  /** The academy has a mail transport. */
  emailAvailable: boolean
}

export const MY_NOTIFICATIONS_PATH = '/api/me/notifications'
export const NOTIFICATION_PREFERENCES_PATH = '/api/me/notification-preferences'

/** `/api/me/notifications?…` with the given parameters only, in a fixed order. */
export function myNotificationsPath(params: ListMyNotificationsParams = {}): string {
  const query = new URLSearchParams()
  if (params.unread) query.set('unread', 'true')
  if (params.category) query.set('category', params.category)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${MY_NOTIFICATIONS_PATH}?${search}` : MY_NOTIFICATIONS_PATH
}

export function listMyNotifications(params: ListMyNotificationsParams = {}, signal?: AbortSignal): Promise<MyNotificationList> {
  return apiRequest<MyNotificationList>(myNotificationsPath(params), { signal })
}

export function getUnreadCount(signal?: AbortSignal): Promise<{ unread: number }> {
  return apiRequest<{ unread: number }>(`${MY_NOTIFICATIONS_PATH}/unread-count`, { signal })
}

/** API-169: sets `readAt` once; a repeat answers the same notification. */
export function markNotificationRead(id: string): Promise<MyNotification> {
  return apiRequest<MyNotification>(`${MY_NOTIFICATIONS_PATH}/${encodeURIComponent(id)}/read`, { method: 'POST' })
}

/** API-170: every unread notification, or those of one category. */
export function markAllNotificationsRead(category?: NotificationCategory): Promise<{ updated: number }> {
  return apiRequest<{ updated: number }>(`${MY_NOTIFICATIONS_PATH}/read-all`, { method: 'POST', body: category ? { category } : {} })
}

export function getNotificationPreferences(signal?: AbortSignal): Promise<NotificationPreferences> {
  return apiRequest<NotificationPreferences>(NOTIFICATION_PREFERENCES_PATH, { signal })
}

/** API-172: replaces the switch of each named category; answers all six. An empty list is `400 nothing_to_update`. */
export function updateNotificationPreferences(categories: NotificationPreference[]): Promise<NotificationPreferences> {
  return apiRequest<NotificationPreferences>(NOTIFICATION_PREFERENCES_PATH, { method: 'PUT', body: { categories } })
}
