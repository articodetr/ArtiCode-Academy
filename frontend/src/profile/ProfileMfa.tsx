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
// re-reads the status. One refusal means more: «already on» answered to the code that turns it on — the answer
// of an earlier try was lost with its recovery codes. The card then says plainly that it is on and that the
// codes were not shown, and keeps saying it beside a «new recovery codes» button until new ones are made. The
// same is said when that code got no answer at all and the dialog was closed instead of retried: the card then
// re-reads the status, and «on» can only be the work of the answer that never came.
// When a dialog goes, the cursor returns to the button that opened it — or, when that button is gone (the state
// changed), to the status line, as soon as it is shown.
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
import { CODES_UNSEEN_KEY } from './mfa.errors'
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
  // It was turned on by an answer that never arrived: nobody saw its recovery codes. The message (an i18n key)
  // stays on the card until new codes are made; null = nothing of the kind.
  const [unseenCodes, setUnseenCodes] = useState<string | null>(null)
  // A code that turns it on got no answer in this visit (the connection dropped): it may be on all the same.
  // The next status read settles it.
  const enableUnanswered = useRef(false)
  // The page's callback as of the latest render, for the status reader below (react(immutability): in an effect).
  const sessionsChanged = useRef(onSessionsChanged)
  useEffect(() => {
    sessionsChanged.current = onSessionsChanged
  })

  useEffect(() => {
    const controller = new AbortController()
    getMfaStatus(controller.signal).then(
      (next) => {
        setStatus(next)
        setFailed(false)
        if (!enableUnanswered.current) return
        enableUnanswered.current = false
        if (next.enabled) {
          // It went through after all: it is on — the other sessions were signed out then — and the recovery
          // codes of the answer that never came were shown to nobody.
          setUnseenCodes(CODES_UNSEEN_KEY)
          sessionsChanged.current?.()
        }
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
  // close, so the modal's own focus return never runs. When that button is gone by then (it was «turn on» and it
  // is on now, or the reverse), the cursor would be left on nothing: the status line takes it instead — at once,
  // or when the re-read status is shown — unless the user has put it somewhere in the meantime.
  const trigger = useRef<HTMLElement | null>(null)
  const statusLine = useRef<HTMLSpanElement>(null)
  const statusAwaitsFocus = useRef(false)
  useEffect(() => {
    if (dialog !== null) return
    const element = trigger.current
    trigger.current = null
    if (element?.isConnected) element.focus({ preventScroll: true })
    else if (element) statusAwaitsFocus.current = true
  }, [dialog])
  useEffect(() => {
    if (!statusAwaitsFocus.current || dialog !== null || !statusLine.current) return
    statusAwaitsFocus.current = false
    const active = document.activeElement
    if (active === null || active === document.body) statusLine.current.focus({ preventScroll: true })
  })

  const open = (next: Dialog) => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    statusAwaitsFocus.current = false
    setEndedSessions(null)
    setDialog(next)
  }

  const close = () => {
    setDialog(null)
    // The setup dialog goes after a code that got no answer: «off» may no longer be true — read it again.
    if (enableUnanswered.current) reload(true)
  }

  /** A dialog found the account in another state than the card shows: say it, and show the truth. */
  const stale = (messageKey: string) => {
    setDialog(null)
    message.warning(t(messageKey))
    reload(true)
  }

  /** It is on now (the setup dialog stays open on the recovery codes). */
  const enabled = () => {
    enableUnanswered.current = false
    setUnseenCodes(null)
    reload(true)
    onSessionsChanged?.()
  }

  /**
   * The code that turns it on was answered «already on»: an earlier answer was lost, and its recovery codes with
   * it. It is on (the other sessions were signed out then), so the card shows that — and says what is missing.
   */
  const enabledUnseen = (messageKey: string) => {
    enableUnanswered.current = false
    setDialog(null)
    setUnseenCodes(messageKey)
    reload(true)
    onSessionsChanged?.()
  }

  /** New recovery codes were made and shown: whatever was missing is there now. */
  const regenerated = () => {
    setUnseenCodes(null)
    reload(false)
  }

  const disabled = (revokedSessions: number) => {
    setDialog(null)
    setUnseenCodes(null)
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
          <span ref={statusLine} tabIndex={-1}>
            <Typography.Text strong data-testid="mfa-status">
              <CheckCircleFilled style={{ color: 'var(--c-ok, #389e0d)', marginInlineEnd: 8 }} aria-hidden="true" />
              {status.enabledAt
                ? t('profile.mfa.enabledSince', { when: formatDateTime(status.enabledAt, language) })
                : t('profile.mfa.statusOn')}
            </Typography.Text>
          </span>
          {left !== null ? (
            <Typography.Text type={low ? 'warning' : 'secondary'} data-testid="mfa-codes-left">
              {t('profile.mfa.recoveryCodesLeft', { count: left })}
            </Typography.Text>
          ) : null}
        </Space>
        {status.available ? (
          <>
            {unseenCodes ? (
              // Nobody has the codes the card counts above: say it, with the way out in one click.
              <Alert
                type="warning"
                showIcon
                title={t(unseenCodes)}
                description={t('profile.mfa.unseenCodesHint')}
                action={
                  <Button size="small" type="primary" icon={<KeyOutlined />} onClick={() => open('regenerate')}>
                    {t('profile.mfa.actions.regenerateNow')}
                  </Button>
                }
                style={{ marginTop: 12 }}
                data-testid="mfa-unseen-codes"
              />
            ) : null}
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
        <span ref={statusLine} tabIndex={-1}>
          <Tag data-testid="mfa-status">{t('profile.mfa.statusOff')}</Tag>
        </span>
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
      {dialog === 'setup' ? (
        <MfaSetupModal
          onClose={close}
          onEnabled={enabled}
          onStale={stale}
          onCodesUnseen={enabledUnseen}
          onEnableUnanswered={() => {
            enableUnanswered.current = true
          }}
        />
      ) : null}
      {dialog === 'regenerate' ? <MfaRecoveryCodesModal onClose={close} onRegenerated={regenerated} onStale={stale} /> : null}
      {dialog === 'disable' ? <MfaDisableModal onClose={close} onDisabled={disabled} onStale={stale} /> : null}
    </>
  )
}
