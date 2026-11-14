// E-mail preferences (MOD-12-T07, API-171/172): one switch per category —
// notifications inside the app are always on, these decide the e-mail copy.
// Saved as ONE PUT of the six switches, only when something changed; the
// screen then shows the server's answer. `emailAvailable` false: the academy
// sends no e-mail at all; `emailVerified` false: nothing is e-mailed until the
// caller confirms an address — the switches are still kept.
import { Alert, App, Button, Flex, Skeleton, Switch, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NOTIFICATION_CATEGORIES, getNotificationPreferences, updateNotificationPreferences } from '../api/notifications'
import type { NotificationPreferences } from '../api/notifications'
import { describeNotificationsFailure, failureMessage } from './notifications.errors'
import { planPreferencesSave, switchesOf } from './notifications.view'
import type { PreferenceSwitches } from './notifications.view'

export function PreferencesTab() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [draft, setDraft] = useState<PreferenceSwitches | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [tick, setTick] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getNotificationPreferences(controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return
        setPreferences(answer)
        setDraft(switchesOf(answer))
        setLoadError(null)
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error)
      },
    )
    return () => controller.abort()
  }, [tick])

  if (loadError && !preferences) {
    return (
      <Alert
        type="error"
        showIcon
        title={failureMessage(t, describeNotificationsFailure(loadError, t))}
        action={
          <Button size="small" onClick={() => setTick((value) => value + 1)}>
            {t('notifications.inbox.retry')}
          </Button>
        }
      />
    )
  }
  if (!preferences || !draft) return <Skeleton active />

  const saved = switchesOf(preferences)
  const plan = planPreferencesSave(saved, draft)

  const save = async () => {
    if (!plan) return
    setSaving(true)
    try {
      const answer = await updateNotificationPreferences(plan)
      setPreferences(answer)
      setDraft(switchesOf(answer))
      message.success(t('notifications.preferences.saved'))
    } catch (error) {
      message.error(failureMessage(t, describeNotificationsFailure(error, t)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="notif-prefs">
      <Typography.Paragraph type="secondary">{t('notifications.preferences.intro')}</Typography.Paragraph>
      {!preferences.emailAvailable ? (
        <Alert type="info" showIcon title={t('notifications.preferences.emailUnavailable')} style={{ marginBottom: 16 }} />
      ) : !preferences.emailVerified ? (
        <Alert type="warning" showIcon title={t('notifications.preferences.emailUnverified')} style={{ marginBottom: 16 }} />
      ) : null}
      <ul className="notif-prefs__list">
        {NOTIFICATION_CATEGORIES.map((category) => {
          const label = t(`notifications.categories.${category}`)
          return (
            <li key={category} className="notif-prefs__row">
              <span className="notif-prefs__text">
                <b>{label}</b>
                <Typography.Text type="secondary">{t(`notifications.preferences.hints.${category}`)}</Typography.Text>
              </span>
              <Switch
                aria-label={t('notifications.preferences.switchLabel', { category: label })}
                checked={draft[category]}
                disabled={saving}
                onChange={(checked) => setDraft((current) => (current ? { ...current, [category]: checked } : current))}
              />
            </li>
          )
        })}
      </ul>
      <Flex gap={8} justify="flex-end" style={{ marginTop: 16 }}>
        <Button disabled={!plan || saving} onClick={() => setDraft(saved)}>
          {t('notifications.preferences.reset')}
        </Button>
        <Button type="primary" disabled={!plan} loading={saving} onClick={() => void save()}>
          {t('notifications.preferences.save')}
        </Button>
      </Flex>
    </div>
  )
}
