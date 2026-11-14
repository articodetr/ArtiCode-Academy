// The inbox (MOD-12-T07, API-167/169/170): the caller's notifications, newest
// first, with the server's own title and body; an unread one carries a chalk
// dot and a bold title. Opening one marks it read (API-169 — the row shows the
// server's answer) and follows its `data.link` inside the app; «mark all as
// read» (API-170) re-reads the list. Times are in the academy's zone.
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Empty, Flex, Segmented, Select, Skeleton, Tag, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { NOTIFICATION_CATEGORIES, markAllNotificationsRead, markNotificationRead } from '../api/notifications'
import type { MyNotification, NotificationCategory } from '../api/notifications'
import { useAcademy } from '../academy/useAcademy'
import { useLocalized } from '../i18n/useLocalized'
import { formatLessonDateTime } from '../lessons/lessons.format'
import { describeNotificationsFailure, failureMessage } from './notifications.errors'
import { notificationLink, notificationZone } from './notifications.view'
import { refreshUnreadCount } from './useUnreadCount'
import { useInbox } from './useInbox'

export function InboxTab() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const { academy } = useAcademy()
  const zone = notificationZone(academy)
  const inbox = useInbox()
  const [markingAll, setMarkingAll] = useState(false)

  const open = (item: MyNotification) => {
    if (item.readAt === null) {
      markNotificationRead(item.id).then(
        (saved) => {
          inbox.replaceItem(saved)
          refreshUnreadCount()
        },
        (error: unknown) => message.error(failureMessage(t, describeNotificationsFailure(error, t))),
      )
    }
    const link = notificationLink(item.data)
    if (link && link !== location.pathname) navigate(link)
  }

  const markAll = async () => {
    setMarkingAll(true)
    try {
      const { updated } = await markAllNotificationsRead()
      message.success(t('notifications.inbox.markedAll', { count: updated }))
      refreshUnreadCount()
      inbox.reload()
    } catch (error) {
      message.error(failureMessage(t, describeNotificationsFailure(error, t)))
    } finally {
      setMarkingAll(false)
    }
  }

  const failure = inbox.error ? describeNotificationsFailure(inbox.error, t) : null
  const filtered = inbox.filters.unread || Boolean(inbox.filters.category)
  const firstLoad = inbox.loading && inbox.items.length === 0 && !failure
  const hasUnread = inbox.items.some((item) => item.readAt === null)

  return (
    <div className="notif-inbox">
      <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
        <Segmented<'all' | 'unread'>
          value={inbox.filters.unread ? 'unread' : 'all'}
          onChange={(value) => inbox.setFilters({ unread: value === 'unread' })}
          options={[
            { value: 'all', label: t('notifications.inbox.all') },
            { value: 'unread', label: t('notifications.inbox.unread') },
          ]}
        />
        <Select<NotificationCategory>
          allowClear
          placeholder={t('notifications.inbox.allCategories')}
          aria-label={t('notifications.inbox.category')}
          value={inbox.filters.category}
          onChange={(value) => inbox.setFilters({ category: value })}
          options={NOTIFICATION_CATEGORIES.map((category) => ({ value: category, label: t(`notifications.categories.${category}`) }))}
          style={{ minWidth: 180 }}
        />
        <Button icon={<ReloadOutlined />} onClick={inbox.reload} aria-label={t('notifications.inbox.refresh')} />
        <span className="notif-inbox__spacer" />
        <Button icon={<CheckOutlined />} onClick={() => void markAll()} loading={markingAll} disabled={!hasUnread && !inbox.nextCursor}>
          {t('notifications.inbox.markAllRead')}
        </Button>
      </Flex>

      {failure ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={inbox.retry}>
              {t('notifications.inbox.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {firstLoad ? (
        <Skeleton active />
      ) : inbox.items.length === 0 && !failure ? (
        <Empty description={filtered ? t('notifications.inbox.emptyFiltered') : t('notifications.inbox.empty')} />
      ) : (
        <ul className="notif-list" aria-label={t('notifications.inbox.listLabel')}>
          {inbox.items.map((item) => {
            const unread = item.readAt === null
            return (
              <li key={item.id}>
                <button type="button" className={`notif-item${unread ? ' notif-item--unread' : ''}`} onClick={() => open(item)}>
                  <span className="notif-item__dot" aria-hidden={!unread} title={unread ? t('notifications.inbox.unreadMark') : undefined}>
                    {unread ? <span className="notif-sr-only">{t('notifications.inbox.unreadMark')}</span> : null}
                  </span>
                  <span className="notif-item__main">
                    <span className="notif-item__title">
                      <bdi dir="auto">{item.title}</bdi>
                    </span>
                    {item.body ? (
                      <Typography.Text type="secondary" className="notif-item__body">
                        <bdi dir="auto">{item.body}</bdi>
                      </Typography.Text>
                    ) : null}
                    <span className="notif-item__meta">
                      <Tag className="notif-category">{t(`notifications.categories.${item.category}`)}</Tag>
                      {item.student ? <span>{item.student.displayName?.trim() || item.student.fullName}</span> : null}
                      <time dateTime={item.createdAt}>{formatLessonDateTime(item.createdAt, language, zone)}</time>
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {inbox.nextCursor ? (
        <Flex justify="center" style={{ marginTop: 16 }}>
          <Button onClick={inbox.loadMore} loading={inbox.loading && inbox.items.length > 0}>
            {t('notifications.inbox.loadMore')}
          </Button>
        </Flex>
      ) : null}
    </div>
  )
}
