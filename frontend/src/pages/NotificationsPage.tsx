import { Badge, Button, Card, List, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { mockNotifications } from '../mock/data'

export function NotificationsPage() {
  const { t } = useTranslation()
  const { localized } = useLocalized()
  const [items, setItems] = useState(mockNotifications)
  const unread = items.filter((n) => !n.read).length

  return (
    <>
      <PageHeader
        title={t('notifications.title')}
        subtitle={t('notifications.subtitle')}
        extra={
          <Button
            disabled={unread === 0}
            onClick={() => setItems((list) => list.map((n) => ({ ...n, read: true })))}
          >
            {t('notifications.markAllRead')}
          </Button>
        }
      />
      <Card>
        <List
          dataSource={items}
          renderItem={(item) => (
            <List.Item extra={<StatusTag value={item.channel} />}>
              <List.Item.Meta
                avatar={<Badge dot={!item.read} />}
                title={localized(item.title)}
                description={
                  <>
                    <Typography.Text type="secondary">{localized(item.body)}</Typography.Text>
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {item.sentAt}
                    </Typography.Text>
                  </>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </>
  )
}
