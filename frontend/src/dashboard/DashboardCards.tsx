// The pieces both staff homes share (the teacher's dashboard in pages/DashboardPage.tsx and the admin home of J-F59 in
// dashboard/admin/): a card's failure with a retry, a card body that waits for its read, and the latest notifications
// of the caller (API-167, by ownership — no key). Moved here from DashboardPage.tsx unchanged (J-F59).
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Badge, Button, Empty, Skeleton, Typography, theme } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import type { MyNotification } from '../api/notifications'
import { useLocalized } from '../i18n/useLocalized'
import { formatLessonDateTime } from '../lessons/lessons.format'
import { notificationZone } from '../notifications/notifications.view'
import type { Reloadable } from './useLoad'

/** How many of the latest notifications a home lists. */
export const RECENT_NOTIFICATIONS = 4

/** A card's failure: a short message and a way to ask again. */
export function CardFailure({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <Alert
      type="warning"
      showIcon
      title={t('dashboard.cardFailed')}
      action={
        <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
          {t('dashboard.retry')}
        </Button>
      }
    />
  )
}

/**
 * The body of a list card: the failure with a retry, a skeleton while reading (also while the read still waits —
 * today's lessons wait for the academy's zone), or the server's answer.
 */
export function CardContent<T>({ loaded, children }: { loaded: Reloadable<T>; children: (data: T) => ReactNode }) {
  if (loaded.error) return <CardFailure onRetry={loaded.retry} />
  if (loaded.loading || loaded.data === null) return <Skeleton active paragraph={{ rows: 3 }} title={false} />
  return <>{children(loaded.data)}</>
}

/** The latest notifications of the caller, newest first, as the server worded them. */
export function RecentNotifications({ items }: { items: MyNotification[] }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { academy } = useAcademy()
  const { token } = theme.useToken()
  if (items.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dashboard.noNotifications')} />
  const zone = notificationZone(academy)
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((item, index) => (
        <li
          key={item.id}
          style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '12px 0', borderTop: index > 0 ? `1px solid ${token.colorSplit}` : undefined }}
        >
          <Badge dot={item.readAt === null} />
          <div style={{ minWidth: 0 }}>
            <Typography.Text strong>
              <bdi dir="auto">{item.title}</bdi>
            </Typography.Text>
            {item.body ? (
              <>
                <br />
                <Typography.Text type="secondary">
                  <bdi dir="auto">{item.body}</bdi>
                </Typography.Text>
              </>
            ) : null}
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <time dateTime={item.createdAt}>{formatLessonDateTime(item.createdAt, language, zone)}</time>
            </Typography.Text>
          </div>
        </li>
      ))}
    </ul>
  )
}
