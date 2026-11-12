// The e-mail preferences of the notifications, on /profile (MOD-12-T07 —
// J-F54): GET/PUT /api/me/notification-preferences (API-171/172 — ownership,
// no key, no audit event). In-app notifications are always on; one switch per
// category (the server's fixed order) says whether its copy is also e-mailed,
// and each switch is saved on its own — a PUT naming that category alone, the
// six answered back and shown as the server returned them. The card explains
// why no e-mail would arrive: the academy has no mail transport
// (`emailAvailable: false`), the account has no address, or the address is not
// confirmed (`emailVerified: false`) — then «send the confirmation e-mail»
// (API-165, LR-01-T02) asks for the e-mail whose link (/verify-email/:token)
// confirms it; the token never reaches this page (D-R78). Every refusal of
// API-165 is worded; `mail_unavailable` and a missing transport disable the
// button with the reason.
import { MailOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Switch, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { requestEmailVerification } from '../api/emailVerification'
import type { NotificationCategory } from '../api/myNotifications'
import { getNotificationPreferences, updateNotificationPreferences } from '../api/notificationPreferences'
import type { NotificationPreferences } from '../api/notificationPreferences'
import { describeVerificationRequestFailure } from '../account/emailVerification.errors'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import { describeNotificationsFailure, failureMessage } from './notifications.errors'

interface CardState {
  preferences: NotificationPreferences | null
  loading: boolean
  error: unknown
}

interface VerificationNotice {
  type: 'success' | 'info' | 'warning' | 'error'
  text: string
}

export function NotificationPreferencesCard() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { language } = useLocalized()
  const { user } = useAuth()
  const [state, setState] = useState<CardState>({ preferences: null, loading: true, error: null })
  const [reads, setReads] = useState(0)
  const [saving, setSaving] = useState<NotificationCategory | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [notice, setNotice] = useState<VerificationNotice | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getNotificationPreferences(controller.signal).then(
      (preferences) => {
        if (!controller.signal.aborted) setState({ preferences, loading: false, error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState((current) => ({ ...current, loading: false, error }))
      },
    )
    return () => controller.abort()
  }, [reads])

  const reload = () => {
    setState((current) => ({ ...current, loading: true, error: null }))
    setReads((value) => value + 1)
  }

  const toggle = async (category: NotificationCategory, emailEnabled: boolean) => {
    setSaving(category)
    try {
      const preferences = await updateNotificationPreferences({ categories: [{ category, emailEnabled }] })
      setState({ preferences, loading: false, error: null })
      message.success(t('profile.notifications.saved'))
    } catch (error) {
      message.error(failureMessage(t, describeNotificationsFailure(error)))
    } finally {
      setSaving(null)
    }
  }

  const askForConfirmation = async () => {
    setRequesting(true)
    setNotice(null)
    try {
      const answer = await requestEmailVerification()
      const date = formatDateTime(answer.expiresAt, language)
      if (answer.delivery.status === 'logged') setNotice({ type: 'info', text: t('profile.emailVerification.logged', { date }) })
      else if (answer.delivery.status === 'sent') setNotice({ type: 'success', text: t('profile.emailVerification.sent', { email: user?.email ?? '', date }) })
      else setNotice({ type: 'warning', text: t('profile.emailVerification.failed') })
    } catch (error) {
      const failure = describeVerificationRequestFailure(error)
      setNotice({ type: failure.alreadyVerifiedAt !== undefined ? 'success' : 'error', text: t(failure.key, failure.params) })
      // The address was confirmed in the meantime (another tab, the e-mailed link): show the card as it is now.
      if (failure.key.endsWith('email_already_verified')) reload()
    } finally {
      setRequesting(false)
    }
  }

  const preferences = state.preferences

  return (
    <Card title={t('profile.notifications.title')} loading={state.loading && preferences === null}>
      {state.error && preferences === null ? (
        <Alert
          type="error"
          showIcon
          title={t('profile.notifications.loadFailed')}
          description={failureMessage(t, describeNotificationsFailure(state.error))}
          action={
            <Button size="small" onClick={reload}>
              {t('profile.notifications.retry')}
            </Button>
          }
        />
      ) : preferences ? (
        <>
          <Typography.Paragraph type="secondary">{t('profile.notifications.intro')}</Typography.Paragraph>

          {!preferences.emailAvailable ? <Alert type="info" showIcon title={t('profile.notifications.unavailable')} style={{ marginBottom: 12 }} /> : null}

          {!preferences.emailVerified ? (
            user?.email ? (
              <Alert
                type="warning"
                showIcon
                title={t('profile.notifications.unverified')}
                description={preferences.emailAvailable ? undefined : t('profile.emailVerification.unavailableHint')}
                action={
                  <Button size="small" icon={<MailOutlined />} loading={requesting} disabled={!preferences.emailAvailable} onClick={() => void askForConfirmation()}>
                    {t('profile.emailVerification.send')}
                  </Button>
                }
                style={{ marginBottom: 12 }}
              />
            ) : (
              <Alert type="warning" showIcon title={t('profile.notifications.noEmail')} style={{ marginBottom: 12 }} />
            )
          ) : null}

          {notice ? <Alert type={notice.type} showIcon title={notice.text} closable={{ onClose: () => setNotice(null) }} style={{ marginBottom: 12 }} /> : null}

          <Flex vertical gap={8}>
            {preferences.categories.map(({ category, emailEnabled }) => {
              const label = t(`notifications.categories.${category}`)
              return (
                <Flex key={category} justify="space-between" align="center" gap={12}>
                  <Typography.Text>{label}</Typography.Text>
                  <Switch
                    checked={emailEnabled}
                    loading={saving === category}
                    disabled={saving !== null}
                    aria-label={t('profile.notifications.switchLabel', { category: label })}
                    onChange={(checked) => void toggle(category, checked)}
                  />
                </Flex>
              )
            })}
          </Flex>
        </>
      ) : null}
    </Card>
  )
}
