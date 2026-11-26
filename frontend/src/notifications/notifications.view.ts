// Pure helpers of the notifications screen (MOD-12-T07): the path a
// notification opens, the preferences diff and the zone its times are shown
// in. No React — unit-tested in notifications.view.test.ts.
import type { NotificationCategory, NotificationPreference, NotificationPreferences } from '../api/notifications'
import { NOTIFICATION_CATEGORIES } from '../api/notifications'
import { academyTimeZoneOf } from '../common/timeZone'
import { deviceTimeZone } from '../timetable/timetable.settings'

/**
 * The frontend path in `data.link`, when it is one: an absolute path of this
 * app (`/my-assignments`), never another origin (`//evil`, `https:`) — the
 * server writes only its own paths, the screen trusts no other.
 */
export function notificationLink(data: Record<string, unknown> | null | undefined): string | null {
  const link = data?.link
  if (typeof link !== 'string') return null
  if (!link.startsWith('/') || link.startsWith('//') || link.includes('\\')) return null
  return link
}

/** The zone every notification time is shown in: the academy's, else this device's. */
export function notificationZone(academy: { timezone?: unknown } | null | undefined): string {
  return academyTimeZoneOf(academy) ?? deviceTimeZone()
}

/**
 * The categories the inbox filter and the e-mail switches offer this viewer: every one, but «assignments» for a viewer
 * whose only server role key is `teacher` — teachers no longer manage assignments (2026-11-26) and the assignment events
 * reach students and guardians only (MOD-12), so nothing of that category ever comes to them. A teacher who is also a
 * student or a guardian keeps it (their own or their children's work). A switch left out keeps its value: the save
 * sends the whole set (`planPreferencesSave()`).
 */
export function categoriesFor(roles: readonly string[]): NotificationCategory[] {
  const teacherOnly = roles.length > 0 && roles.every((key) => key === 'teacher')
  return teacherOnly ? NOTIFICATION_CATEGORIES.filter((category) => category !== 'assignments') : [...NOTIFICATION_CATEGORIES]
}

export type PreferenceSwitches = Record<NotificationCategory, boolean>

/** The six switches of an API-171 answer; a category the answer lacks reads as on (a missing row = on). */
export function switchesOf(preferences: NotificationPreferences): PreferenceSwitches {
  const switches = Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, true])) as PreferenceSwitches
  for (const entry of preferences.categories) switches[entry.category] = entry.emailEnabled
  return switches
}

/** The API-172 body when something changed — the whole set of six — else null. */
export function planPreferencesSave(saved: PreferenceSwitches, draft: PreferenceSwitches): NotificationPreference[] | null {
  const changed = NOTIFICATION_CATEGORIES.some((category) => saved[category] !== draft[category])
  return changed ? NOTIFICATION_CATEGORIES.map((category) => ({ category, emailEnabled: draft[category] })) : null
}
