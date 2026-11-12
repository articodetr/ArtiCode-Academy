// The bell of the header (MOD-12-T07 — J-F54), for every signed-in user: the
// unread count of API-168 — polled every 60 s while the page is visible, asked
// again at once after any mark-read (useUnreadCount, D-R86) — and a panel with
// the latest notifications (API-167, BELL_PANEL_SIZE of them, read afresh each
// time it opens). Opening one marks it read (API-169), closes the panel and
// goes to its `data.link`; «mark all» marks every unread one (API-170); the
// footer leads to /notifications. A failed count keeps the last one, without a
// banner in the header.
import { BellOutlined } from '@ant-design/icons'
import { Alert, App, Badge, Button, Flex, Popover, Spin, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { listMyNotifications, markAllNotificationsRead } from '../api/myNotifications'
import type { MyNotification } from '../api/myNotifications'
import { useAuth } from '../auth/auth-context'
import { NotificationEntry } from './NotificationEntry'
import { describeNotificationsFailure, failureMessage } from './notifications.errors'
import { BELL_PANEL_SIZE, INBOX_LINK, notificationLink } from './notifications.view'
import { useNotificationMarking } from './useNotificationMarking'
import { refreshUnreadCount, useUnreadCount } from './useUnreadCount'
import './notifications.css'

export function NotificationBell() {
  const { t } = useTranslation()
  const { unread } = useUnreadCount()
  const [open, setOpen] = useState(false)
  // A new panel for every opening, so it reads the latest notifications again (a closed popup may stay mounted).
  const [opening, setOpening] = useState(0)
  const count = unread ?? 0

  const onOpenChange = (next: boolean) => {
    if (next) setOpening((value) => value + 1)
    setOpen(next)
  }

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger="click"
      placement="bottomRight"
      arrow={false}
      destroyOnHidden
      content={<BellPanel key={opening} unread={count} onClose={() => setOpen(false)} />}
    >
      <Button
        type="text"
        shape="circle"
        className="notification-bell"
        aria-label={count > 0 ? t('notifications.bell.labelUnread', { count }) : t('notifications.bell.label')}
        icon={
          <Badge count={count} size="small" overflowCount={99}>
            <BellOutlined style={{ fontSize: 18 }} />
          </Badge>
        }
      />
    </Popover>
  )
}

interface PanelState {
  items: MyNotification[]
  loading: boolean
  error: unknown
}

function BellPanel({ unread, onClose }: { unread: number; onClose: () => void }) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState<PanelState>({ items: [], loading: true, error: null })
  const [reads, setReads] = useState(0)
  const [markingAll, setMarkingAll] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    listMyNotifications({ limit: BELL_PANEL_SIZE }, controller.signal).then(
      (list) => {
        if (!controller.signal.aborted) setState({ items: list.items, loading: false, error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState((current) => ({ ...current, loading: false, error }))
      },
    )
    return () => controller.abort()
  }, [reads])

  const reload = useCallback(() => {
    setState((current) => ({ ...current, loading: true }))
    setReads((value) => value + 1)
  }, [])
  const replace = useCallback((answer: MyNotification) => {
    setState((current) => ({ ...current, items: current.items.map((item) => (item.id === answer.id ? answer : item)) }))
  }, [])
  const { markRead } = useNotificationMarking(replace, reload)

  const go = (link: string) => {
    onClose()
    navigate(link)
  }

  const open = (item: MyNotification) => {
    void markRead(item)
    const link = notificationLink(item)
    if (link) go(link)
  }

  const markAll = async () => {
    setMarkingAll(true)
    try {
      await markAllNotificationsRead()
      refreshUnreadCount()
      reload()
    } catch (error) {
      message.error(failureMessage(t, describeNotificationsFailure(error)))
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <div className="notification-bell__panel">
      <Flex justify="space-between" align="center" gap={8} style={{ marginBottom: 8 }}>
        <Typography.Text strong>{t('notifications.bell.title')}</Typography.Text>
        {unread > 0 ? (
          <Button type="link" size="small" loading={markingAll} onClick={() => void markAll()}>
            {t('notifications.markAllRead')}
          </Button>
        ) : null}
      </Flex>

      {state.error && state.items.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          title={t('notifications.bell.loadFailed')}
          description={failureMessage(t, describeNotificationsFailure(state.error))}
          action={
            <Button size="small" onClick={reload}>
              {t('notifications.bell.retry')}
            </Button>
          }
        />
      ) : (
        <Spin spinning={state.loading}>
          {state.items.length > 0 ? (
            <ul className="notification-list notification-bell__list" aria-label={t('notifications.bell.title')}>
              {state.items.map((item) => (
                <NotificationEntry key={item.id} item={item} viewerId={user?.id} onOpen={open} />
              ))}
            </ul>
          ) : (
            <Typography.Paragraph type="secondary" style={{ margin: '12px 0', minHeight: 24 }}>
              {state.loading ? null : t('notifications.bell.empty')}
            </Typography.Paragraph>
          )}
        </Spin>
      )}

      <Flex justify="center" style={{ marginTop: 8 }}>
        <Button type="link" onClick={() => go(INBOX_LINK)}>
          {t('notifications.bell.viewAll')}
        </Button>
      </Flex>
    </div>
  )
}
