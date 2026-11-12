// E-mail preferences of the notifications (MOD-12-T02 — J-F54): API-171 GET and
// API-172 PUT /api/me/notification-preferences. Types mirror the preference
// DTOs of backend/src/notifications/my-notifications.dto.ts field by field.
// Ownership, no permission key (D-R84/D-R86): the caller's own switches. In-app
// notifications are always on; a switch says whether that category is also
// e-mailed — which happens only to a confirmed address (`emailVerified`, set
// through API-165/166) and only when the academy has a mail transport
// (`emailAvailable`). A PUT replaces the categories it names and leaves the
// others; no audit event (a personal preference).
import { apiRequest } from './client'
import type { NotificationCategory } from './myNotifications'

/** `NotificationPreferenceDto`. */
export interface NotificationPreference {
  category: NotificationCategory
  /** true until the user switches it off (no row = on). */
  emailEnabled: boolean
}

/** `NotificationPreferencesDto` (API-171, and the answer of API-172). */
export interface NotificationPreferences {
  /** The six categories, always all of them, in the fixed order. */
  categories: NotificationPreference[]
  /** The caller has an e-mail address they confirmed; without it nothing is e-mailed whatever the switches say. */
  emailVerified: boolean
  /** The academy sends e-mail at all (MAIL_TRANSPORT is not `none`). */
  emailAvailable: boolean
}

/** `UpdateNotificationPreferencesDto`: 1–6 entries, no category twice; `emailEnabled` a JSON boolean. */
export interface UpdateNotificationPreferencesInput {
  categories: NotificationPreference[]
}

export const NOTIFICATION_PREFERENCES_PATH = '/api/me/notification-preferences'

/** API-171. */
export function getNotificationPreferences(signal?: AbortSignal): Promise<NotificationPreferences> {
  return apiRequest<NotificationPreferences>(NOTIFICATION_PREFERENCES_PATH, { signal })
}

/** API-172: answers the six categories after the change; 400 `nothing_to_update` for an empty list. */
export function updateNotificationPreferences(input: UpdateNotificationPreferencesInput): Promise<NotificationPreferences> {
  return apiRequest<NotificationPreferences>(NOTIFICATION_PREFERENCES_PATH, { method: 'PUT', body: input })
}
