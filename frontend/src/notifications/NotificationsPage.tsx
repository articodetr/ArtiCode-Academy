// The notifications screen (MOD-12-T07): three tabs — the inbox (API-167..170,
// everyone), the e-mail preferences (API-171/172, everyone) and the sent
// announcements with the form to send one (API-173..175, holders of
// `notifications.send` only). Every «my» route works by ownership.
import { Card, Tabs } from 'antd'
import type { TabsProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { AnnouncementsTab } from './AnnouncementsTab'
import { InboxTab } from './InboxTab'
import { PreferencesTab } from './PreferencesTab'
import './notifications.css'

const SEND_NOTIFICATIONS_PERMISSION = 'notifications.send'

export function NotificationsPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canSend = hasPermission(SEND_NOTIFICATIONS_PERMISSION)
  const [tab, setTab] = useState('inbox')

  const items: TabsProps['items'] = [
    { key: 'inbox', label: t('notifications.tabs.inbox'), children: <Card><InboxTab /></Card> },
    { key: 'preferences', label: t('notifications.tabs.preferences'), children: <Card><PreferencesTab /></Card> },
    ...(canSend ? [{ key: 'announcements', label: t('notifications.tabs.announcements'), children: <AnnouncementsTab /> }] : []),
  ]

  return (
    <>
      <PageHeader title={t('notifications.title')} subtitle={t('notifications.subtitle')} />
      <Tabs activeKey={tab} onChange={setTab} items={items} destroyOnHidden />
    </>
  )
}
