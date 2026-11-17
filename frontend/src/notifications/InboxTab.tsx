// The inbox (MOD-12-T07, API-167/169/170): the caller's notifications, newest
// first, with the server's own title and body (and an announcement's sender);
// an unread one carries a chalk dot and a bold title. Opening one marks it read
// (API-169 — the row shows the server's answer) and follows its `data.link`
// inside the app; «mark all as read» (API-170 — of the chosen category only,
// when one is chosen) re-reads the list. Times are in the academy's zone.
// The inbox follows the header bell: the bell's count (useLatestUnread — no
// second poll) is compared with its count when the list was last read from its
// first page; a higher one offers the new notifications in a bar (the list
// never moves under the reader) and enables «mark all».
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Empty, Flex, Segmented, Select, Skeleton, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { NOTIFICATION_CATEGORIES, markAllNotificationsRead, markNotificationRead } from '../api/notifications'
import type { MyNotification, NotificationCategory } from '../api/notifications'
import { useAcademy } from '../academy/useAcademy'
import { useLocalized } from '../i18n/useLocalized'
import { formatLessonDateTime } from '../lessons/lessons.format'
import { describeNotificationsFailure, failureMessage } from './notifications.errors'
import { notificationLink, notificationZone } from './notifications.view'
import { refreshUnreadCount, useLatestUnread } from './useUnreadCount'
import { useInbox } from './useInbox'
import type { InboxFilters } from './useInbox'

/** The bell's count the inbox compares with: the first one received after `after` (a serial) is the baseline. */
interface CountWatch {
  after: number
  baseline: number | null
}

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
  const latest = useLatestUnread()
  const [watch, setWatch] = useState<CountWatch>(() => ({ after: latest?.serial ?? 0, baseline: null }))
  // The bell's count read since the list was last read from its first page; null until it arrives.
  const count = latest !== null && latest.serial > watch.after ? latest.unread : null
  // The first such count is the baseline; a lower one (read here or elsewhere) lowers it, so a later rise shows.
  if (count !== null && (watch.baseline === null || count < watch.baseline)) setWatch({ after: watch.after, baseline: count })
  const newer = count !== null && watch.baseline !== null && count > watch.baseline

  // A fresh count for the list this mount reads (the bell's last one may be up to a minute old).
  useEffect(() => {
    refreshUnreadCount()
  }, [])

  /** The list is read again from its first page: the next count of the bell becomes the baseline. */
  const rebase = () => {
    setWatch({ after: latest?.serial ?? 0, baseline: null })
    refreshUnreadCount()
  }

  const reload = () => {
    rebase()
    inbox.reload()
  }

  const setFilters = (patch: Partial<InboxFilters>) => {
    rebase()
    inbox.setFilters(patch)
  }

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
      // API-170 takes the category: with a category filter only that category is marked, as the list shows.
      const { updated } = await markAllNotificationsRead(inbox.filters.category)
      message.success(t('notifications.inbox.markedAll', { count: updated }))
      reload()
    } catch (error) {
      message.error(failureMessage(t, describeNotificationsFailure(error, t)))
    } finally {
      setMarkingAll(false)
    }
  }

  const failure = inbox.error ? describeNotificationsFailure(inbox.error, t) : null
  const filtered = inbox.filters.unread || Boolean(inbox.filters.category)
  const firstLoad = inbox.loading && inbox.items.length === 0 && !failure
  // An unread row on the page, more pages, or — without a category filter (the bell counts every category) — the
  // bell's count: a notification that arrived after the list was read is unread too.
  const canMarkAll = inbox.items.some((item) => item.readAt === null) || Boolean(inbox.nextCursor) || (!inbox.filters.category && (count ?? 0) > 0)

  return (
    <div className="notif-inbox">
      <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
        <Segmented<'all' | 'unread'>
          value={inbox.filters.unread ? 'unread' : 'all'}
          onChange={(value) => setFilters({ unread: value === 'unread' })}
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
          onChange={(value) => setFilters({ category: value })}
          options={NOTIFICATION_CATEGORIES.map((category) => ({ value: category, label: t(`notifications.categories.${category}`) }))}
          style={{ minWidth: 180 }}
        />
        <Button icon={<ReloadOutlined />} onClick={reload} aria-label={t('notifications.inbox.refresh')} />
        <span className="notif-inbox__spacer" />
        <Button icon={<CheckOutlined />} onClick={() => void markAll()} loading={markingAll} disabled={!canMarkAll}>
          {t('notifications.inbox.markAllRead')}
        </Button>
      </Flex>

      {newer ? (
        <Alert
          className="notif-newer"
          type="info"
          role="status"
          showIcon
          title={t('notifications.inbox.newer')}
          action={
            <Button size="small" onClick={reload}>
              {t('notifications.inbox.showNewer')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

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
                      {/* API-167 names an announcement's sender (CH-0277): the display name, else the full name. */}
                      {item.sender ? (
                        <span className="notif-item__sender">
                          {t('notifications.inbox.from')} <bdi dir="auto">{item.sender.displayName?.trim() || item.sender.fullName}</bdi>
                        </span>
                      ) : null}
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
