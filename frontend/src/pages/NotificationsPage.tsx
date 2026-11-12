// «My notifications» (MOD-12-T07 — J-F54): GET /api/me/notifications (API-167)
// for every signed-in user — ownership, no permission key (D-R86): the
// caller's own notifications, newest first, with the filters «unread» and
// «category» (ANDed by the server) and keyset pages. Each row is unread or read,
// shows its category, the child it is about for a guardian, when it arrived,
// and the title and body worded by the server in the reader's language (plain
// text — never translated, never HTML). Opening a row marks it read (API-169)
// and goes to its `data.link` (an announcement's link is this page, so it
// only marks); «mark all» marks every unread one — or those of the chosen
// category (API-170). Every mark asks the header bell's count again at once
// (refreshUnreadCount). The mock list of the prototype is gone.
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Empty, Flex, Segmented, Select, Space, Spin, Typography } from 'antd'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { NOTIFICATION_CATEGORIES, markAllNotificationsRead } from '../api/myNotifications'
import type { MyNotification, NotificationCategory } from '../api/myNotifications'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { NotificationEntry } from '../notifications/NotificationEntry'
import { describeNotificationsFailure, failureMessage } from '../notifications/notifications.errors'
import { INBOX_LINK, notificationLink } from '../notifications/notifications.view'
import { useMyNotifications } from '../notifications/useMyNotifications'
import { useNotificationMarking } from '../notifications/useNotificationMarking'
import { refreshUnreadCount } from '../notifications/useUnreadCount'

type View = 'all' | 'unread'

export function NotificationsPage() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { user } = useAuth()
  const navigate = useNavigate()
  const list = useMyNotifications()
  const { filters, replaceItem, reload } = list
  const [markingAll, setMarkingAll] = useState(false)
  const { marking, markRead } = useNotificationMarking(replaceItem, reload)

  const open = useCallback(
    (item: MyNotification) => {
      void markRead(item)
      const link = notificationLink(item)
      // An announcement points at this page: opening it only marks it read.
      if (link && link !== INBOX_LINK) navigate(link)
    },
    [markRead, navigate],
  )

  const markAll = async () => {
    setMarkingAll(true)
    try {
      const { updated } = await markAllNotificationsRead(filters.category)
      if (updated > 0) message.success(t('notifications.markedAll', { count: updated }))
      else message.info(t('notifications.nothingUnread'))
      reload()
      refreshUnreadCount()
    } catch (error) {
      message.error(failureMessage(t, describeNotificationsFailure(error)))
    } finally {
      setMarkingAll(false)
    }
  }

  const failure = list.error ? describeNotificationsFailure(list.error) : null
  const emptyText =
    filters.category !== undefined ? t('notifications.empty.filtered') : filters.unread ? t('notifications.empty.unread') : t('notifications.empty.all')
  const markAllLabel = filters.category
    ? t('notifications.markCategoryRead', { category: t(`notifications.categories.${filters.category}`) })
    : t('notifications.markAllRead')

  return (
    <>
      <PageHeader
        title={t('notifications.title')}
        subtitle={t('notifications.subtitle')}
        extra={
          <Button icon={<CheckOutlined />} loading={markingAll} onClick={() => void markAll()}>
            {markAllLabel}
          </Button>
        }
      />

      <Card>
        <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
          <Segmented<View>
            aria-label={t('notifications.views.label')}
            value={filters.unread ? 'unread' : 'all'}
            onChange={(view) => list.setFilters({ unread: view === 'unread' })}
            options={[
              { value: 'all', label: t('notifications.views.all') },
              { value: 'unread', label: t('notifications.views.unread') },
            ]}
          />
          <Select<NotificationCategory | undefined>
            allowClear
            placeholder={t('notifications.filters.allCategories')}
            aria-label={t('notifications.filters.category')}
            value={filters.category}
            onChange={(category) => list.setFilters({ category })}
            options={NOTIFICATION_CATEGORIES.map((category) => ({ value: category, label: t(`notifications.categories.${category}`) }))}
            style={{ minWidth: 200 }}
          />
          <Button icon={<ReloadOutlined />} onClick={reload} aria-label={t('notifications.refresh')} />
        </Flex>

        {failure ? (
          <Alert
            type="error"
            showIcon
            title={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={reload}>
                {t('notifications.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Spin spinning={list.loading}>
          {list.items.length > 0 ? (
            <ul className="notification-list" aria-label={t('notifications.title')}>
              {list.items.map((item) => (
                <NotificationEntry
                  key={item.id}
                  item={item}
                  viewerId={user?.id}
                  onOpen={open}
                  onMarkRead={(row) => void markRead(row)}
                  marking={marking.includes(item.id)}
                />
              ))}
            </ul>
          ) : list.loading ? (
            <div style={{ minHeight: 96 }} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
          )}
        </Spin>

        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
          <Typography.Text type="secondary">{t('notifications.pagination.page', { page: list.pageNumber })}</Typography.Text>
          <Space>
            <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
              {t('notifications.pagination.previous')}
            </Button>
            <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
              {t('notifications.pagination.next')}
            </Button>
          </Space>
        </Flex>
      </Card>
    </>
  )
}
