// «التحقق بخطوتين» on the profile (MOD-01-H06 — API-206..API-210): the caller's own two-step verification (TOTP).
// The card reads its status (API-206) on mount and shows one of:
// - off → what it is, and «turn on» (MfaSetupModal: password → QR / key + code → the recovery codes, once);
// - on → since when, how many recovery codes are left (a warning from 3 down), «new recovery codes»
//   (MfaRecoveryCodesModal) and «turn off» (MfaDisableModal: password + a code or a recovery code);
// - `available: false` (the server has no MFA key) → a note instead of buttons that could only fail; while it is
//   on for the account the note says that signing in is blocked until the key is back.
// Every dialog is mounted per session (KI-049) and unmounted on close, so a secret, a code or the recovery codes
// never outlive it. Turning it on or off signs the caller's other sessions out: the card then re-reads its status
// and tells the page through `onSessionsChanged`, which makes the devices card re-read its list. A refusal that
// means «the card is out of date» (already on, already off, no server key) closes the dialog with the message and
// re-reads the status.
import { CheckCircleFilled, KeyOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { Alert, App, Button, Skeleton, Space, Tag, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getMfaStatus } from '../api/mfa'
import type { MfaStatus } from '../api/mfa'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import { MfaDisableModal } from './MfaDisableModal'
import { MfaRecoveryCodesModal } from './MfaRecoveryCodesModal'
import { MfaSetupModal } from './MfaSetupModal'
import { isLowOnRecoveryCodes } from './mfa.format'

interface ProfileMfaProps {
  /** Two-step verification was turned on or off: the caller's other sessions were signed out (API-208/209). */
  onSessionsChanged?: () => void
}

type Dialog = 'setup' | 'regenerate' | 'disable'

export function ProfileMfa({ onSessionsChanged }: ProfileMfaProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [status, setStatus] = useState<MfaStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  // After «turn off»: how many other sessions ended (0 or more); null = nothing was turned off in this visit.
  const [endedSessions, setEndedSessions] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getMfaStatus(controller.signal).then(
      (next) => {
        setStatus(next)
        setFailed(false)
      },
      () => {
        if (!controller.signal.aborted) setFailed(true)
      },
    )
    return () => controller.abort()
  }, [tick])

  /** Re-reads API-206. `stale` first takes down what is shown — it is known to be out of date. */
  const reload = (stale: boolean) => {
    if (stale) setStatus(null)
    setFailed(false)
    setTick((value) => value + 1)
  }

  // The button that opened the dialog gets the cursor back when the dialog goes — the dialogs are unmounted on
  // close, so the modal's own focus return never runs. A button that is gone by then (the state changed) is skipped.
  const trigger = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (dialog !== null) return
    const element = trigger.current
    trigger.current = null
    if (element?.isConnected) element.focus({ preventScroll: true })
  }, [dialog])

  const open = (next: Dialog) => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setEndedSessions(null)
    setDialog(next)
  }

  const close = () => setDialog(null)

  /** A dialog found the account in another state than the card shows: say it, and show the truth. */
  const stale = (messageKey: string) => {
    setDialog(null)
    message.warning(t(messageKey))
    reload(true)
  }

  /** It is on now (the setup dialog stays open on the recovery codes). */
  const enabled = () => {
    reload(true)
    onSessionsChanged?.()
  }

  const disabled = (revokedSessions: number) => {
    setDialog(null)
    setEndedSessions(revokedSessions)
    reload(true)
    onSessionsChanged?.()
  }

  let body: ReactNode
  if (failed) {
    body = (
      <Alert
        type="warning"
        showIcon
        title={t('profile.mfa.loadFailed')}
        action={
          <Button size="small" icon={<ReloadOutlined />} onClick={() => reload(true)}>
            {t('profile.mfa.retry')}
          </Button>
        }
      />
    )
  } else if (status === null) {
    body = <Skeleton active paragraph={{ rows: 2 }} title={false} />
  } else if (status.enabled) {
    const left = status.recoveryCodesLeft
    const low = isLowOnRecoveryCodes(left)
    body = (
      <>
        <Space orientation="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Text strong data-testid="mfa-status">
            <CheckCircleFilled style={{ color: 'var(--c-ok, #389e0d)', marginInlineEnd: 8 }} aria-hidden="true" />
            {status.enabledAt
              ? t('profile.mfa.enabledSince', { when: formatDateTime(status.enabledAt, language) })
              : t('profile.mfa.statusOn')}
          </Typography.Text>
          {left !== null ? (
            <Typography.Text type={low ? 'warning' : 'secondary'} data-testid="mfa-codes-left">
              {t('profile.mfa.recoveryCodesLeft', { count: left })}
            </Typography.Text>
          ) : null}
        </Space>
        {status.available ? (
          <>
            {low ? (
              <Alert
                type="warning"
                showIcon
                title={t(left === 0 ? 'profile.mfa.noRecoveryCodes' : 'profile.mfa.lowRecoveryCodes')}
                style={{ marginTop: 12 }}
              />
            ) : null}
            <Space wrap style={{ marginTop: 16 }}>
              <Button icon={<KeyOutlined />} onClick={() => open('regenerate')}>
                {t('profile.mfa.actions.regenerate')}
              </Button>
              <Button danger onClick={() => open('disable')}>
                {t('profile.mfa.actions.disable')}
              </Button>
            </Space>
          </>
        ) : (
          // Neither action could work without the server key, so none is offered.
          <Alert type="error" showIcon title={t('profile.mfa.unavailableEnabled')} style={{ marginTop: 12 }} />
        )}
      </>
    )
  } else {
    body = (
      <>
        <Tag data-testid="mfa-status">{t('profile.mfa.statusOff')}</Tag>
        <Typography.Paragraph style={{ marginTop: 12 }}>{t('profile.mfa.intro')}</Typography.Paragraph>
        {status.available ? (
          <Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => open('setup')}>
            {t('profile.mfa.actions.enable')}
          </Button>
        ) : (
          <Alert type="info" showIcon title={t('profile.mfa.unavailable')} />
        )}
      </>
    )
  }

  return (
    <>
      {endedSessions !== null && !status?.enabled ? (
        <Alert
          type="success"
          showIcon
          title={t('profile.mfa.disabledNotice')}
          description={endedSessions > 0 ? t('profile.mfa.sessionsEnded', { count: endedSessions }) : undefined}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {body}
      {/* One dialog at a time, mounted for its session only: closing it drops every secret it held. */}
      {dialog === 'setup' ? <MfaSetupModal onClose={close} onEnabled={enabled} onStale={stale} /> : null}
      {dialog === 'regenerate' ? <MfaRecoveryCodesModal onClose={close} onRegenerated={() => reload(false)} onStale={stale} /> : null}
      {dialog === 'disable' ? <MfaDisableModal onClose={close} onDisabled={disabled} onStale={stale} /> : null}
    </>
  )
}
