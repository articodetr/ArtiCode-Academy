import { ReloadOutlined } from '@ant-design/icons'
import { Badge, Button, Card, Descriptions, Space, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useHealth, useReadiness } from '../api/useHealth'
import type { DatabaseStatus } from '../api/health'

const DB_BADGE: Record<DatabaseStatus, 'success' | 'error' | 'warning'> = {
  up: 'success',
  down: 'error',
  not_configured: 'warning',
}

/** Live checks against GET /api/health (process) and GET /api/health/ready (database). */
export function ServerStatusCard() {
  const { t } = useTranslation()
  const health = useHealth()
  const readiness = useReadiness()
  const checking = health.state.kind === 'checking' || readiness.state.kind === 'checking'

  const serverBadge =
    health.state.kind === 'ok' ? (
      <Badge status="success" text={t('server.online')} />
    ) : health.state.kind === 'error' ? (
      <Badge status="error" text={t('server.offline')} />
    ) : (
      <Badge status="processing" text={t('server.checking')} />
    )

  const database =
    readiness.state.kind === 'ok' ? readiness.state.data.checks.database : null
  const databaseBadge =
    database ? (
      <Badge status={DB_BADGE[database.status]} text={t(`server.db_${database.status}`)} />
    ) : readiness.state.kind === 'error' ? (
      <Badge status="error" text={t('server.offline')} />
    ) : (
      <Badge status="processing" text={t('server.checking')} />
    )

  const refresh = () => {
    health.refresh()
    readiness.refresh()
  }

  return (
    <Card
      size="small"
      title={
        <Space>
          <span>{t('server.title')}</span>
          {serverBadge}
        </Space>
      }
      extra={
        <Button size="small" icon={<ReloadOutlined />} onClick={refresh} loading={checking}>
          {t('server.refresh')}
        </Button>
      }
      style={{ marginBottom: 16 }}
    >
      {health.state.kind === 'ok' ? (
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, lg: 5 }}
          items={[
            { key: 'service', label: t('server.service'), children: health.state.data.service },
            { key: 'version', label: t('server.version'), children: health.state.data.version },
            { key: 'environment', label: t('server.environment'), children: health.state.data.environment },
            { key: 'uptime', label: t('server.uptime'), children: `${health.state.data.uptimeSeconds}s` },
            {
              key: 'database',
              label: t('server.database'),
              children: (
                <Space size={4} wrap>
                  {databaseBadge}
                  {database?.latencyMs !== undefined ? (
                    <Typography.Text type="secondary">({database.latencyMs} ms)</Typography.Text>
                  ) : null}
                  {database?.error ? (
                    <Typography.Text type="secondary" code>
                      {database.error}
                    </Typography.Text>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
      ) : health.state.kind === 'error' ? (
        <Typography.Text type="danger">
          {t('server.offlineHint')} <Typography.Text code>{health.state.error}</Typography.Text>
        </Typography.Text>
      ) : (
        <Typography.Text type="secondary">{t('server.checking')}</Typography.Text>
      )}
    </Card>
  )
}
