// Announcements (MOD-12-T07 — J-F54): GET /api/announcements (API-174) for a
// holder of `notifications.send` (the nav entry `announcements` and the route
// are gated by that key — the teacher and the academy admin by seed). A holder
// reads the announcements they sent; a holder of `classes.manage` reads every
// announcement of the academy (D-R85) — the page says which. Newest first,
// keyset pages, and the contract's one filter: the class (`classId`, from the
// class list the caller may read — API-050, `classes.read`). A row opens the
// detail (API-175: who read it, its e-mail copies by state); «new
// announcement» opens the composer (API-173). The title and the body are the
// sender's plain text — never HTML.
import { NotificationOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Announcement } from '../api/announcements'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { useLocalized } from '../i18n/useLocalized'
import { AnnouncementAudience } from '../notifications/AnnouncementAudience'
import { AnnouncementComposer } from '../notifications/AnnouncementComposer'
import { AnnouncementDrawer } from '../notifications/AnnouncementDrawer'
import { describeNotificationsFailure, failureMessage } from '../notifications/notifications.errors'
import { useAnnouncementsList } from '../notifications/useAnnouncementsList'
import { ClassPicker } from '../timetable/TimetablePickers'
import { displayNameOf, formatDateTime } from '../users/users.format'

export function AnnouncementsPage() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const canManageClasses = hasPermission('classes.manage')
  const canReadClasses = hasPermission('classes.read')
  const list = useAnnouncementsList()
  const [composing, setComposing] = useState(false)
  const [shown, setShown] = useState<{ id: string; preview: Announcement | null } | null>(null)

  const columns: TableProps<Announcement>['columns'] = [
    { title: t('announcements.columns.sentAt'), key: 'sentAt', render: (_, row) => formatDateTime(row.createdAt, language) },
    {
      title: t('announcements.columns.title'),
      key: 'title',
      render: (_, row) => (
        <Button type="link" onClick={() => setShown({ id: row.id, preview: row })} style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'start' }}>
          <span dir="auto">{row.title}</span>
        </Button>
      ),
    },
    { title: t('announcements.columns.audience'), key: 'audience', render: (_, row) => <AnnouncementAudience announcement={row} /> },
    { title: t('announcements.columns.recipients'), key: 'recipients', render: (_, row) => <span dir="ltr">{row.recipientCount}</span> },
    {
      title: t('announcements.columns.sender'),
      key: 'sender',
      render: (_, row) => (row.sender ? displayNameOf(row.sender) : <Typography.Text type="secondary">{t('announcements.drawer.noSender')}</Typography.Text>),
    },
    {
      title: t('announcements.columns.email'),
      key: 'email',
      render: (_, row) => <Tag color={row.sendEmail ? 'cyan' : 'default'}>{row.sendEmail ? t('announcements.withEmail') : t('announcements.withoutEmail')}</Tag>,
    },
  ]

  const failure = list.error ? describeNotificationsFailure(list.error) : null

  return (
    <>
      <PageHeader
        title={t('announcements.title')}
        subtitle={t('announcements.subtitle')}
        extra={
          <Button type="primary" icon={<NotificationOutlined />} onClick={() => setComposing(true)}>
            {t('announcements.compose')}
          </Button>
        }
      />

      <Card>
        <Typography.Paragraph type="secondary">{canManageClasses ? t('announcements.hintAll') : t('announcements.hintOwn')}</Typography.Paragraph>

        <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
          {canReadClasses ? (
            <ClassPicker
              allowClear
              placeholder={t('announcements.filters.allClasses')}
              aria-label={t('announcements.filters.class')}
              value={list.filters.classId}
              onChange={(value) => list.setFilters({ classId: value })}
              style={{ minWidth: 260 }}
            />
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('announcements.refresh')} />
        </Flex>

        {failure ? (
          <Alert
            type="error"
            showIcon
            title={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={list.reload}>
                {t('announcements.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<Announcement>
          rowKey="id"
          columns={columns}
          dataSource={list.items}
          loading={list.loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: list.filters.classId ? t('announcements.empty.filtered') : t('announcements.empty.all') }}
        />

        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
          <Typography.Text type="secondary">{t('announcements.pagination.page', { page: list.pageNumber })}</Typography.Text>
          <Space>
            <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
              {t('announcements.pagination.previous')}
            </Button>
            <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
              {t('announcements.pagination.next')}
            </Button>
          </Space>
        </Flex>
      </Card>

      <AnnouncementComposer
        open={composing}
        canManageClasses={canManageClasses}
        canReadClasses={canReadClasses}
        onClose={() => setComposing(false)}
        onSent={(announcement) => {
          setComposing(false)
          message.success(t('announcements.composer.sent', { count: announcement.recipientCount }))
          // Newest first: back to the first page, read again.
          list.setFilters({})
          list.reload()
          setShown({ id: announcement.id, preview: announcement })
        }}
      />

      <AnnouncementDrawer announcementId={shown?.id ?? null} preview={shown?.preview ?? null} onClose={() => setShown(null)} />
    </>
  )
}
