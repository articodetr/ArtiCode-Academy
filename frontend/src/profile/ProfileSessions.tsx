// «Where you're signed in» on the profile (CH-0265, on MOD-01-H06 — API-201/202 of CH-0272): one row per device
// that can still refresh its session, newest activity first, as the server sends them. Every other device can be
// signed out (one confirmation each), or all of them at once while this one stays; this device is signed out with
// the page's own «sign out» button. The access token a signed-out device already holds stays valid until it
// expires (15 minutes by default) — the card says so.
import { DesktopOutlined, LogoutOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Empty, Popconfirm, Skeleton, Space, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import { listSessions, revokeSession } from '../api/sessions'
import type { SessionItem } from '../api/sessions'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import { deviceOf } from './sessions.format'
import './sessions.css'

export function ProfileSessions() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [items, setItems] = useState<SessionItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    listSessions(controller.signal).then(
      (list) => {
        setItems(list.items)
        setFailed(false)
      },
      () => {
        if (!controller.signal.aborted) setFailed(true)
      },
    )
    return () => controller.abort()
  }, [tick])

  /** Signs one device out; a session that is already gone (404) just leaves the list. */
  const signOut = async (id: string): Promise<boolean> => {
    try {
      await revokeSession(id)
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return true
      throw error
    }
  }

  const signOutOne = async (session: SessionItem) => {
    setBusy(session.id)
    try {
      await signOut(session.id)
      setItems((current) => current?.filter((item) => item.id !== session.id) ?? null)
      message.success(t('profile.sessions.signedOut'))
    } catch {
      message.error(t('profile.sessions.failed'))
    } finally {
      setBusy(null)
    }
  }

  const signOutOthers = async () => {
    const others = (items ?? []).filter((item) => !item.current)
    setBusy('others')
    try {
      for (const session of others) await signOut(session.id)
      message.success(t('profile.sessions.othersSignedOut', { count: others.length }))
    } catch {
      message.error(t('profile.sessions.failed'))
    } finally {
      setBusy(null)
      reload()
    }
  }

  const name = (session: SessionItem) => {
    const { browser, system } = deviceOf(session.userAgent)
    if (browser && system) return t('profile.sessions.browserOn', { browser, system })
    return browser ?? system ?? t('profile.sessions.unknownDevice')
  }

  if (failed) {
    return (
      <Alert
        type="warning"
        showIcon
        title={t('profile.sessions.loadFailed')}
        action={
          <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
            {t('profile.sessions.retry')}
          </Button>
        }
      />
    )
  }
  if (items === null) return <Skeleton active paragraph={{ rows: 2 }} title={false} />
  if (items.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('profile.sessions.empty')} />

  const others = items.filter((item) => !item.current).length
  return (
    <>
      <ul className="profile-sessions">
        {items.map((session) => (
          <li key={session.id} data-session={session.id}>
            <DesktopOutlined className="profile-sessions__icon" aria-hidden="true" />
            <div className="profile-sessions__text">
              <Typography.Text strong>{name(session)}</Typography.Text>
              <Typography.Text type="secondary">
                {t('profile.sessions.lastActive', { when: formatDateTime(session.lastActiveAt, language) })}
                {session.ipAddress ? (
                  <>
                    {' · '}
                    <bdi dir="ltr">{session.ipAddress.replace(/^::ffff:/i, '')}</bdi>
                  </>
                ) : null}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('profile.sessions.since', { when: formatDateTime(session.startedAt, language) })}
              </Typography.Text>
            </div>
            {session.current ? (
              <Tag color="green">{t('profile.sessions.thisDevice')}</Tag>
            ) : (
              <Popconfirm
                title={t('profile.sessions.confirmOne', { device: name(session) })}
                okText={t('profile.sessions.signOut')}
                cancelText={t('common.cancel')}
                onConfirm={() => void signOutOne(session)}
              >
                <Button size="small" icon={<LogoutOutlined />} loading={busy === session.id} disabled={busy !== null && busy !== session.id}>
                  {t('profile.sessions.signOut')}
                </Button>
              </Popconfirm>
            )}
          </li>
        ))}
      </ul>
      {others > 0 ? (
        <Space orientation="vertical" size={8} style={{ marginTop: 12, width: '100%' }}>
          <Popconfirm title={t('profile.sessions.confirmOthers', { count: others })} okText={t('profile.sessions.signOutOthers')} cancelText={t('common.cancel')} onConfirm={() => void signOutOthers()}>
            <Button danger icon={<LogoutOutlined />} loading={busy === 'others'} disabled={busy !== null && busy !== 'others'}>
              {t('profile.sessions.signOutOthers')}
            </Button>
          </Popconfirm>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('profile.sessions.hint')}
          </Typography.Text>
        </Space>
      ) : null}
    </>
  )
}
