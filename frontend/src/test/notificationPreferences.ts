// Fixtures for the e-mail preferences of the notifications (MOD-12-T02 —
// J-F54): API-171/172 as the backend returns them (my-notifications.dto.ts).
import { NOTIFICATION_CATEGORIES } from '../api/myNotifications'
import type { NotificationCategory } from '../api/myNotifications'
import type { NotificationPreferences } from '../api/notificationPreferences'

/** The six categories in their fixed order, e-mail on except `off`; a confirmed address and a mail transport unless overridden. */
export function makePreferences(
  overrides: Partial<Omit<NotificationPreferences, 'categories'>> = {},
  off: readonly NotificationCategory[] = [],
): NotificationPreferences {
  return {
    categories: NOTIFICATION_CATEGORIES.map((category) => ({ category, emailEnabled: !off.includes(category) })),
    emailVerified: true,
    emailAvailable: true,
    ...overrides,
  }
}
