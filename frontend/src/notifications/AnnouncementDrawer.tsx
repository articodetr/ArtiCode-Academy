// One announcement (MOD-12-T07 — J-F54): GET /api/announcements/:id (API-175)
// for its sender, or for any holder of `classes.manage` — another sender's is a
// 404 like an unknown one. It shows what was sent — the title and the body as
// typed (plain text, its line breaks kept), the audience, the sender and when
// — and what became of it: the recipients when it was sent, how many of them
// read it, and its e-mail copies by state (counts only; no list of names in
// v1). The counts are computed when read, so «refresh» reads them again. The
// row of the list (or the answer of API-173) is shown while the detail loads.
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Descriptions, Drawer, Flex, Space, Spin, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getAnnouncement } from '../api/announcements'
import type { Announcement, AnnouncementDetail, AnnouncementEmailCounts } from '../api/announcements'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, formatDateTime } from '../users/users.format'
import { AnnouncementAudience } from './AnnouncementAudience'
import { describeNotificationsFailure, failureMessage } from './notifications.errors'

const EMAIL_STATES: ReadonlyArray<keyof AnnouncementEmailCounts> = ['none', 'queued', 'sent', 'failed', 'skipped']

interface AnnouncementDrawerProps {
  /** The announcement to show; null keeps the drawer closed. */
  announcementId: string | null
  /** What is already known of it (its list row, or the answer of the send), shown while the detail loads. */
  preview: Announcement | null
  onClose: () => void
}

export function AnnouncementDrawer({ announcementId, preview, onClose }: AnnouncementDrawerProps) {
  const { t } = useTranslation()
  return (
    <Drawer open={announcementId !== null} onClose={onClose} title={t('announcements.drawer.title')} size="min(640px, 100vw)" destroyOnHidden>
      {announcementId ? <AnnouncementDetailBody key={announcementId} id={announcementId} preview={preview?.id === announcementId ? preview : null} /> : null}
    </Drawer>
  )
}

interface DetailState {
  detail: AnnouncementDetail | null
  loading: boolean
  error: unknown
}

function AnnouncementDetailBody({ id, preview }: { id: string; preview: Announcement | null }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [state, setState] = useState<DetailState>({ detail: null, loading: true, error: null })
  const [reads, setReads] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getAnnouncement(id, controller.signal).then(
      (detail) => {
        if (!controller.signal.aborted) setState({ detail, loading: false, error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState((current) => ({ ...current, loading: false, error }))
      },
    )
    return () => controller.abort()
  }, [id, reads])

  const reload = () => {
    setState((current) => ({ ...current, loading: true }))
    setReads((value) => value + 1)
  }

  const shown: Announcement | null = state.detail ?? preview
  const detail = state.detail
  const failure = state.error ? describeNotificationsFailure(state.error) : null

  return (
    <Spin spinning={state.loading}>
      {failure ? (
        <Alert
          type="error"
          showIcon
          title={t('announcements.drawer.loadFailed')}
          description={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={reload}>
              {t('announcements.drawer.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {shown ? (
        <>
          <Typography.Title level={4} style={{ marginTop: 0 }}>
            <span dir="auto">{shown.title}</span>
          </Typography.Title>
          {/* The sender's words as typed: plain text, line breaks kept, never HTML. */}
          <div dir="auto" data-testid="announcement-body" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBottom: 16 }}>
            {shown.body}
          </div>

          <Descriptions
            size="small"
            column={1}
            bordered
            items={[
              { key: 'sentAt', label: t('announcements.drawer.sentAt'), children: formatDateTime(shown.createdAt, language) },
              {
                key: 'sender',
                label: t('announcements.drawer.sender'),
                children: shown.sender ? displayNameOf(shown.sender) : <Typography.Text type="secondary">{t('announcements.drawer.noSender')}</Typography.Text>,
              },
              { key: 'audience', label: t('announcements.drawer.audience'), children: <AnnouncementAudience announcement={shown} /> },
              { key: 'recipients', label: t('announcements.drawer.recipients'), children: <span dir="ltr">{shown.recipientCount}</span> },
              {
                key: 'read',
                label: t('announcements.drawer.readCount'),
                children: detail ? t('announcements.drawer.readOf', { read: detail.readCount, total: shown.recipientCount }) : '—',
              },
              {
                key: 'email',
                label: t('announcements.drawer.email'),
                children: <Tag color={shown.sendEmail ? 'cyan' : 'default'}>{shown.sendEmail ? t('announcements.withEmail') : t('announcements.withoutEmail')}</Tag>,
              },
              {
                key: 'emailCounts',
                label: t('announcements.drawer.emailCounts'),
                children: detail ? (
                  <Space orientation="vertical" size={2}>
                    {EMAIL_STATES.map((emailState) => (
                      <span key={emailState} data-email-state={emailState}>
                        {t(`announcements.drawer.emailStates.${emailState}`)}: <span dir="ltr">{detail.email[emailState]}</span>
                      </span>
                    ))}
                  </Space>
                ) : (
                  '—'
                ),
              },
            ]}
          />

          <Flex justify="space-between" align="center" wrap gap={8} style={{ marginTop: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('announcements.drawer.countsHint')}
            </Typography.Text>
            <Button icon={<ReloadOutlined />} onClick={reload} disabled={state.loading}>
              {t('announcements.drawer.refresh')}
            </Button>
          </Flex>
        </>
      ) : (
        <div style={{ minHeight: 120 }} />
      )}
    </Spin>
  )
}
