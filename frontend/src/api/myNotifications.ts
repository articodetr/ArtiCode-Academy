// «My notifications» (MOD-12-T02 — J-F54): API-167 GET /api/me/notifications,
// API-168 GET /api/me/notifications/unread-count, API-169 POST
// /api/me/notifications/:id/read and API-170 POST /api/me/notifications/read-all.
// Types mirror backend/src/notifications/my-notifications.dto.ts field by field;
// the calls go through apiRequest (Bearer header, refresh-and-retry on 401).
// Ownership, no permission key (D-R86): every signed-in user reads, counts and
// marks their own notifications only — another user's is a 404 like an unknown
// one. `title` and `body` were worded once, in the recipient's language, when
// the notification was created: they are shown as they come, never translated
// and never read as HTML. No call here records an audit event.
import { apiRequest } from './client'

/** The six categories in the fixed order the server lists them (NOTIFICATION_CATEGORIES of notifications.events.ts). */
export const NOTIFICATION_CATEGORIES = ['lessons', 'assignments', 'exams', 'grades', 'finance', 'announcements'] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)
}

/** `NotificationStudentDto`: the student a notification is about — the caller themself or their child. */
export interface NotificationStudent {
  id: string
  fullName: string
  displayName: string | null
}

/** `MyNotificationDto`. */
export interface MyNotification {
  id: string
  /** The event: a lower-case dotted key (`lesson.cancelled`, `submission.graded`, `invoice.issued`, `announcement` …). */
  eventKey: string
  category: NotificationCategory
  /** Worded once, in the recipient's language at the time the notification was created — plain text. */
  title: string
  /** Plain text (an announcement keeps its sender's line breaks). */
  body: string
  /**
   * The frontend path to open (`link`: /my-lessons, /my-assignments, /my-exams, /my-grades,
   * /my-certificates, /my-invoices or /notifications) and the ids of the event — never a name,
   * a score or an amount; `studentIds` in a guardian's copy of a class event about several children.
   */
  data: Record<string, unknown>
  /** null for an announcement and for a class event about several children (the body names them). */
  student: NotificationStudent | null
  /** Set for a manual announcement (API-173). */
  announcementId: string | null
  /** ISO 8601 — when the caller marked it as read; null while unread. */
  readAt: string | null
  /** ISO 8601 */
  createdAt: string
}

/** `MyNotificationListDto`: newest first (keyset on the UUIDv7 id). */
export interface MyNotificationList {
  items: MyNotification[]
  /** Cursor of the next, older page; null on the last page. */
  nextCursor: string | null
}

/** `UnreadCountDto`. */
export interface UnreadCount {
  /** The caller's notifications not read yet. */
  unread: number
}

/** `ReadAllResultDto`. */
export interface ReadAllResult {
  /** Notifications this call marked as read (0 when nothing was unread). */
  updated: number
}

/** `ListMyNotificationsQueryDto`. */
export interface ListMyNotificationsParams {
  /** 1–100, server default 20. */
  limit?: number
  /** The `nextCursor` of the previous page, sent with the same filters. */
  cursor?: string
  /** true: only the notifications not read yet; absent: all of them (the client never sends false). */
  unread?: boolean
  category?: NotificationCategory
}

/** Page sizes of API-167: 1–100, 20 by default (MY_NOTIFICATIONS_PAGE_DEFAULT / _MAX). */
export const MY_NOTIFICATIONS_PAGE_DEFAULT = 20
export const MY_NOTIFICATIONS_PAGE_MAX = 100

export const MY_NOTIFICATIONS_PATHS = {
  list: '/api/me/notifications',
  unreadCount: '/api/me/notifications/unread-count',
  read: (id: string) => `/api/me/notifications/${encodeURIComponent(id)}/read`,
  readAll: '/api/me/notifications/read-all',
} as const

/** `/api/me/notifications?…` with the given parameters only, in a fixed order; `unread` goes as the literal `true`. */
export function myNotificationsPath(params: ListMyNotificationsParams = {}): string {
  const query = new URLSearchParams()
  if (params.unread === true) query.set('unread', 'true')
  if (params.category) query.set('category', params.category)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${MY_NOTIFICATIONS_PATHS.list}?${search}` : MY_NOTIFICATIONS_PATHS.list
}

/** API-167 (ownership): 400 on an unknown filter value or a malformed cursor. */
export function listMyNotifications(params: ListMyNotificationsParams = {}, signal?: AbortSignal): Promise<MyNotificationList> {
  return apiRequest<MyNotificationList>(myNotificationsPath(params), { signal })
}

/** API-168: what the header bell polls (D-R86 — every 60 s while the page is visible). */
export function getUnreadCount(signal?: AbortSignal): Promise<UnreadCount> {
  return apiRequest<UnreadCount>(MY_NOTIFICATIONS_PATHS.unreadCount, { signal })
}

/** API-169: sets `readAt` once — a repeat answers the same notification; 404 `notification_not_found` for another user's or an unknown id. */
export function markNotificationRead(id: string): Promise<MyNotification> {
  return apiRequest<MyNotification>(MY_NOTIFICATIONS_PATHS.read(id), { method: 'POST' })
}

/** API-170: every unread notification of the caller, or of one category (the body is sent only with a category). */
export function markAllNotificationsRead(category?: NotificationCategory): Promise<ReadAllResult> {
  return apiRequest<ReadAllResult>(MY_NOTIFICATIONS_PATHS.readAll, { method: 'POST', body: category ? { category } : undefined })
}
