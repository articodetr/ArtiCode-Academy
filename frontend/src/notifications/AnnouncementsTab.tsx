// The caller's sent announcements (MOD-12-T07, API-174) — all of them for a
// holder of `classes.manage` — each opening its detail (API-175) in a drawer
// that docks beside the table on a wide screen; «new announcement» opens the
// API-173 form. Shown only to holders of `notifications.send` (the page hides
// the tab otherwise; the server stays the boundary).
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Flex, Space, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Announcement } from '../api/announcements'
import { useAcademy } from '../academy/useAcademy'
import { useDockedPanel } from '../common/useDockedPanel'
import { useLocalized } from '../i18n/useLocalized'
import { formatLessonDateTime } from '../lessons/lessons.format'
import { AnnouncementDrawer } from './AnnouncementDrawer'
import { audienceLabel } from './announcements.format'
import { CreateAnnouncementModal } from './CreateAnnouncementModal'
import { describeNotificationsFailure, failureMessage } from './notifications.errors'
import { notificationZone } from './notifications.view'
import { useAnnouncementsList } from './useAnnouncementsList'

export function AnnouncementsTab() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { academy } = useAcademy()
  const zone = notificationZone(academy)
  const list = useAnnouncementsList()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const { docked, dockedIn, panelRef, wide, open, layoutClassName } = useDockedPanel(selectedId, setSelectedId)

  const columns: TableProps<Announcement>['columns'] = [
    {
      title: t('notifications.announcements.columns.title'),
      key: 'title',
      render: (_, row) => (
        <span className="list-primary">
          <b>
            <bdi dir="auto">{row.title}</bdi>
          </b>
          <span>{audienceLabel(row, t, language)}</span>
        </span>
      ),
    },
    { title: t('notifications.announcements.columns.recipients'), key: 'recipients', render: (_, row) => row.recipientCount },
    {
      title: t('notifications.announcements.columns.email'),
      key: 'email',
      render: (_, row) => (row.sendEmail ? t('notifications.announcements.withEmail') : t('notifications.announcements.noEmail')),
    },
    {
      title: t('notifications.announcements.columns.sender'),
      key: 'sender',
      render: (_, row) => (row.sender ? row.sender.displayName?.trim() || row.sender.fullName : t('notifications.announcements.senderGone')),
    },
    { title: t('notifications.announcements.columns.sentAt'), key: 'sentAt', render: (_, row) => formatLessonDateTime(row.createdAt, language, zone) },
  ]

  const failure = list.error ? describeNotificationsFailure(list.error, t) : null

  return (
    <>
      <Flex gap={12} align="center" wrap style={{ marginBottom: 16 }}>
        <Typography.Text type="secondary">{t('notifications.announcements.intro')}</Typography.Text>
        <span className="notif-inbox__spacer" />
        <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('notifications.inbox.refresh')} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          {t('notifications.announcements.new')}
        </Button>
      </Flex>

      <div className={layoutClassName}>
        <Card className="list-with-panel__main">
          {failure ? <Alert type="error" showIcon title={failureMessage(t, failure)} style={{ marginBottom: 16 }} /> : null}
          <Table<Announcement>
            rowKey="id"
            columns={docked ? columns.filter((column) => ['title', 'sentAt'].includes(String(column.key))) : columns}
            dataSource={list.items}
            loading={list.loading}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: t('notifications.announcements.empty') }}
            onRow={(row) => ({ onClick: () => open(row.id), style: { cursor: 'pointer' } })}
            rowClassName={(row) => (row.id === selectedId ? 'list-row--open' : '')}
          />
          <Flex justify="flex-end" style={{ marginTop: 16 }}>
            <Space>
              <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
                {t('notifications.announcements.previous')}
              </Button>
              <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
                {t('notifications.announcements.next')}
              </Button>
            </Space>
          </Flex>
        </Card>
        {wide ? <aside ref={panelRef} className="list-panel" aria-hidden={!docked} /> : null}
      </div>

      <AnnouncementDrawer key={docked ? selectedId : 'overlay'} announcementId={selectedId} onClose={() => setSelectedId(null)} dockedIn={dockedIn} />

      <CreateAnnouncementModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false)
          list.reload()
          setSelectedId(created.id)
        }}
      />
    </>
  )
}
