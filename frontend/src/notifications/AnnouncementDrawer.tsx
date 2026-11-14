// One announcement (API-175): its audience, the sender's words as typed, and
// what became of it — how many recipients read it and the state of its e-mail
// copies (counts only, never a list of recipients). Docks beside the list on a
// wide screen (useDockedPanel); it holds no editor.
import { Alert, Descriptions, Drawer, Skeleton, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getAnnouncement } from '../api/announcements'
import type { AnnouncementDetail } from '../api/announcements'
import { useAcademy } from '../academy/useAcademy'
import { dockedDrawerProps } from '../common/useDockedPanel'
import { useLocalized } from '../i18n/useLocalized'
import { formatLessonDateTime } from '../lessons/lessons.format'
import { audienceLabel } from './announcements.format'
import { describeNotificationsFailure, failureMessage } from './notifications.errors'
import { notificationZone } from './notifications.view'

interface AnnouncementDrawerProps {
  announcementId: string | null
  onClose: () => void
  dockedIn?: HTMLElement | null
}

const EMAIL_STATES = ['sent', 'queued', 'failed', 'skipped', 'none'] as const

export function AnnouncementDrawer({ announcementId, onClose, dockedIn }: AnnouncementDrawerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { academy } = useAcademy()
  const zone = notificationZone(academy)
  const [shown, setShown] = useState<{ id: string; detail: AnnouncementDetail | null; error: unknown } | null>(null)

  useEffect(() => {
    if (!announcementId) return
    const controller = new AbortController()
    getAnnouncement(announcementId, controller.signal).then(
      (detail) => {
        if (!controller.signal.aborted) setShown({ id: announcementId, detail, error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setShown({ id: announcementId, detail: null, error })
      },
    )
    return () => controller.abort()
  }, [announcementId])

  const current = shown && shown.id === announcementId ? shown : null
  const detail = current?.detail ?? null

  return (
    <Drawer
      open={announcementId !== null}
      onClose={onClose}
      {...dockedDrawerProps(dockedIn, false, 'large')}
      title={detail ? <bdi dir="auto">{detail.title}</bdi> : t('notifications.announcements.drawer.title')}
      destroyOnHidden
    >
      {!current ? (
        <Skeleton active />
      ) : current.error ? (
        <Alert type="error" showIcon title={failureMessage(t, describeNotificationsFailure(current.error, t))} />
      ) : detail ? (
        <>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label={t('notifications.announcements.columns.audience')}>{audienceLabel(detail, t, language)}</Descriptions.Item>
            <Descriptions.Item label={t('notifications.announcements.columns.sentAt')}>{formatLessonDateTime(detail.createdAt, language, zone)}</Descriptions.Item>
            <Descriptions.Item label={t('notifications.announcements.columns.sender')}>
              {detail.sender ? detail.sender.displayName?.trim() || detail.sender.fullName : t('notifications.announcements.senderGone')}
            </Descriptions.Item>
            <Descriptions.Item label={t('notifications.announcements.columns.recipients')}>{detail.recipientCount}</Descriptions.Item>
            <Descriptions.Item label={t('notifications.announcements.drawer.read')}>
              {t('notifications.announcements.drawer.readOf', { read: detail.readCount, total: detail.recipientCount })}
            </Descriptions.Item>
            <Descriptions.Item label={t('notifications.announcements.columns.email')}>
              {detail.sendEmail ? (
                <span className="notif-email-counts">
                  {EMAIL_STATES.map((state) => (
                    <Tag key={state} className="notif-category">
                      {t(`notifications.announcements.emailStates.${state}`)}: {detail.email[state]}
                    </Tag>
                  ))}
                </span>
              ) : (
                t('notifications.announcements.noEmail')
              )}
            </Descriptions.Item>
          </Descriptions>
          <Typography.Title level={2} className="section-title" style={{ marginTop: 20 }}>
            {t('notifications.announcements.fields.body')}
          </Typography.Title>
          <Typography.Paragraph className="notif-announcement-body">
            <bdi dir="auto">{detail.body}</bdi>
          </Typography.Paragraph>
        </>
      ) : null}
    </Drawer>
  )
}
