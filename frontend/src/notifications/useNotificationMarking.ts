// Marking one notification read (API-169) for the page and the bell's panel
// (J-F54): the server's answer replaces the row (onMarked), the header count
// is asked again at once (refreshUnreadCount), and a refusal is said — a
// notification that is gone (404 notification_not_found) makes the caller read
// its list again (onGone). The call is idempotent on the server; a second
// click while the first runs is ignored here.
import { App } from 'antd'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import { markNotificationRead } from '../api/myNotifications'
import type { MyNotification } from '../api/myNotifications'
import { describeNotificationsFailure, failureMessage } from './notifications.errors'
import { isUnread } from './notifications.view'
import { refreshUnreadCount } from './useUnreadCount'

export function useNotificationMarking(onMarked: (item: MyNotification) => void, onGone: () => void) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  // The ids whose request runs: a ref for the handlers (read at click time), state for the buttons.
  const running = useRef(new Set<string>())
  const [marking, setMarking] = useState<readonly string[]>([])

  const markRead = useCallback(
    async (item: MyNotification) => {
      if (!isUnread(item) || running.current.has(item.id)) return
      running.current.add(item.id)
      setMarking([...running.current])
      try {
        onMarked(await markNotificationRead(item.id))
        refreshUnreadCount()
      } catch (error) {
        message.error(failureMessage(t, describeNotificationsFailure(error)))
        if (error instanceof ApiError && error.code === 'notification_not_found') onGone()
      } finally {
        running.current.delete(item.id)
        setMarking([...running.current])
      }
    },
    [message, onGone, onMarked, t],
  )

  return { marking, markRead }
}
