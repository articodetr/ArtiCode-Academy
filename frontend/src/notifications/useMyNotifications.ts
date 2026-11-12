// State of the «my notifications» list (J-F54): API-167 through the shared
// keyset hook — a filter change starts again from the newest page, «next»
// follows the server's `nextCursor`, a stale answer is dropped. Marking a
// notification read replaces its row with the server's answer (API-169).
import { listMyNotifications } from '../api/myNotifications'
import type { MyNotification } from '../api/myNotifications'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'
import { DEFAULT_MY_NOTIFICATIONS_FILTERS, myNotificationsQuery } from './notifications.view'
import type { MyNotificationsFilters } from './notifications.view'

const loadMyNotifications: KeysetLoader<MyNotification, MyNotificationsFilters> = (filters, cursor, signal) =>
  listMyNotifications(myNotificationsQuery(filters, cursor), signal)

export function useMyNotifications(initialFilters: MyNotificationsFilters = DEFAULT_MY_NOTIFICATIONS_FILTERS) {
  return useKeysetList(loadMyNotifications, initialFilters)
}
