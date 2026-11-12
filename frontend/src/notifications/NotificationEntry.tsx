// One notification of «my notifications» (J-F54), on the page and in the
// header bell's panel: whether it is unread, its category, the child it is
// about (a guardian's copy), when it arrived, its title — a button that opens
// it (marks it read and goes to its `data.link`) — and its body. The title and
// the body are shown exactly as the server worded them in the reader's
// language: React text, never translated, never HTML; an announcement keeps
// its sender's line breaks.
import { Button, Tag, theme } from 'antd'
import { useTranslation } from 'react-i18next'
import type { MyNotification } from '../api/myNotifications'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, formatDateTime } from '../users/users.format'
import { NOTIFICATION_CATEGORY_COLORS, aboutStudent, isUnread } from './notifications.view'
import './notifications.css'

interface NotificationEntryProps {
  item: MyNotification
  /** The signed-in user: their own notifications name no student. */
  viewerId: string | undefined
  /** Opens it: marks it read (when unread) and goes to its link. */
  onOpen: (item: MyNotification) => void
  /** The page's «mark as read» button (the bell's panel has none). */
  onMarkRead?: (item: MyNotification) => void
  /** Its mark-read request is running. */
  marking?: boolean
}

export function NotificationEntry({ item, viewerId, onOpen, onMarkRead, marking = false }: NotificationEntryProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { token } = theme.useToken()
  const unread = isUnread(item)
  const student = aboutStudent(item, viewerId)

  return (
    <li
      className="notification-item"
      data-notification-id={item.id}
      style={{ borderColor: token.colorBorderSecondary, background: unread ? token.colorPrimaryBg : undefined }}
    >
      <div className="notification-item__main">
        <div className="notification-item__meta">
          {unread ? (
            <Tag color="blue" style={{ margin: 0 }}>
              {t('notifications.unread')}
            </Tag>
          ) : null}
          <Tag color={NOTIFICATION_CATEGORY_COLORS[item.category]} style={{ margin: 0 }}>
            {t(`notifications.categories.${item.category}`)}
          </Tag>
          {student ? (
            <Tag style={{ margin: 0 }}>
              <bdi>{t('notifications.about', { name: displayNameOf(student) })}</bdi>
            </Tag>
          ) : null}
          <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>{formatDateTime(item.createdAt, language)}</span>
        </div>
        <button
          type="button"
          dir="auto"
          className={`notification-item__title${unread ? '' : ' notification-item__title--read'}`}
          style={{ color: token.colorLink }}
          onClick={() => onOpen(item)}
        >
          {item.title}
        </button>
        <div dir="auto" className="notification-item__body" style={{ color: token.colorTextSecondary }}>
          {item.body}
        </div>
      </div>
      {onMarkRead && unread ? (
        <div className="notification-item__actions">
          <Button size="small" loading={marking} onClick={() => onMarkRead(item)}>
            {t('notifications.markRead')}
          </Button>
        </div>
      ) : null}
    </li>
  )
}
