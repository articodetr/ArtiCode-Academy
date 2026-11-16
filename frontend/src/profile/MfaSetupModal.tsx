// Turning two-step verification on from «حسابي», in three steps of one dialog (mounted per session by the card —
// KI-049 — so every form starts empty and nothing of an earlier session is left):
// (a) the current password → API-207 answers the new secret, once;
// (b) the secret as a QR code (and as a Base32 key to type by hand) and a 6-digit code of the authenticator app
//     → API-208; an expired setup (`409 mfa_setup_required`) drops the secret and returns to (a) with a notice;
// (c) the ten recovery codes, once (RecoveryCodesList): Escape, the mask and × are off there, and «close» waits
//     for the tick — the codes must not vanish by accident.
// Closing before (c) simply discards the setup (the server forgets an unconfirmed secret after 10 minutes). The
// secret and the codes live in this component's state only and go with it; nothing is stored or logged.
import { CopyOutlined } from '@ant-design/icons'
import { Alert, App, Button, Form, Modal, Steps, Typography } from 'antd'
import type { InputRef } from 'antd'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { enableMfa, setupMfa } from '../api/mfa'
import type { MfaEnabled, MfaSetup } from '../api/mfa'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import { MfaCodeField, MfaPasswordField } from './MfaFields'
import { RecoveryCodesList } from './RecoveryCodesList'
import { compactCode, groupSecret, isTotpCode } from './mfa.format'
import { useMfaSubmit } from './useMfaSubmit'
import './mfa.css'

interface MfaSetupModalProps {
  /** The dialog goes: before step (c) the setup is discarded; from step (c) the codes were confirmed saved. */
  onClose: () => void
  /** API-208 answered: two-step verification is on and the other sessions were signed out. */
  onEnabled: () => void
  /** The account's state is not what the card shows: close with this message (an i18n key) and re-read. */
  onStale: (messageKey: string) => void
}

const STEPS = ['password', 'verify', 'codes'] as const

export function MfaSetupModal({ onClose, onEnabled, onStale }: MfaSetupModalProps) {
  const { t } = useTranslation()
  const [setup, setSetup] = useState<MfaSetup | null>(null)
  const [enabled, setEnabled] = useState<MfaEnabled | null>(null)
  const [busy, setBusy] = useState(false)
  // Why the dialog is back on step (a): the setup expired before its code was confirmed.
  const [notice, setNotice] = useState<string | null>(null)
  const step = enabled ? 'codes' : setup ? 'verify' : 'password'
  // The codes are shown once: from step (c) only its own «close» ends the dialog; a running request is never left.
  const closable = !busy && step !== 'codes'

  return (
    <Modal
      open
      title={t('profile.mfa.setup.title')}
      footer={null}
      onCancel={onClose}
      closable={closable}
      keyboard={closable}
      mask={{ closable }}
      destroyOnHidden
    >
      <Steps
        size="small"
        current={STEPS.indexOf(step)}
        items={STEPS.map((key) => ({ title: t(`profile.mfa.setup.steps.${key}`) }))}
        style={{ marginBottom: 24 }}
      />
      {step === 'password' ? (
        <PasswordStep
          notice={notice}
          onBusyChange={setBusy}
          onCancel={onClose}
          onStale={onStale}
          onSetup={(next) => {
            setNotice(null)
            setSetup(next)
          }}
        />
      ) : null}
      {step === 'verify' && setup ? (
        <VerifyStep
          setup={setup}
          onBusyChange={setBusy}
          onCancel={onClose}
          onStale={onStale}
          onExpired={(messageKey) => {
            setSetup(null)
            setNotice(t(messageKey))
          }}
          onEnabled={(result) => {
            setSetup(null)
            setEnabled(result)
            onEnabled()
          }}
        />
      ) : null}
      {enabled ? (
        <>
          <Alert
            type="success"
            showIcon
            title={t('profile.mfa.setup.done')}
            description={enabled.revokedSessions > 0 ? t('profile.mfa.setup.othersSignedOut', { count: enabled.revokedSessions }) : undefined}
            style={{ marginBottom: 16 }}
          />
          <RecoveryCodesList codes={enabled.recoveryCodes} generatedAt={enabled.enabledAt} onDone={onClose} />
        </>
      ) : null}
    </Modal>
  )
}

interface StepProps {
  onBusyChange: (busy: boolean) => void
  onCancel: () => void
  onStale: (messageKey: string) => void
}

/** Step (a): the current password starts a setup (API-207). */
function PasswordStep({ notice, onBusyChange, onCancel, onStale, onSetup }: StepProps & { notice: string | null; onSetup: (setup: MfaSetup) => void }) {
  const { t } = useTranslation()
  const [form] = Form.useForm<{ password: string }>()
  const password = useRef<InputRef>(null)
  const { busy, error, run } = useMfaSubmit({ form, focus: () => password.current?.focus(), onStale, onBusyChange })

  useEffect(() => {
    password.current?.focus()
  }, [])

  return (
    <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void run(() => setupMfa(values.password), onSetup)}>
      {notice ? <Alert type="warning" showIcon title={notice} style={{ marginBottom: 16 }} /> : null}
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Typography.Paragraph>{t('profile.mfa.setup.passwordIntro')}</Typography.Paragraph>
      <MfaPasswordField inputRef={password} />
      <div className="profile-mfa__footer">
        <Button onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button type="primary" htmlType="submit" loading={busy}>
          {t('profile.mfa.setup.continue')}
        </Button>
      </div>
    </Form>
  )
}

interface VerifyStepProps extends StepProps {
  setup: MfaSetup
  onExpired: (messageKey: string) => void
  onEnabled: (result: MfaEnabled) => void
}

/** Step (b): the secret for the authenticator app, then a code of it turns two-step verification on (API-208). */
function VerifyStep({ setup, onBusyChange, onCancel, onStale, onExpired, onEnabled }: VerifyStepProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [form] = Form.useForm<{ code: string }>()
  const code = useRef<InputRef>(null)
  const key = useRef<HTMLElement>(null)
  const { busy, error, refuse, run } = useMfaSubmit({
    form,
    focus: () => code.current?.focus(),
    onStale,
    onSetupExpired: onExpired,
    onBusyChange,
  })

  const copyKey = async () => {
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard API unavailable')
      // Without the spaces of the display: every authenticator app takes the bare key.
      await navigator.clipboard.writeText(setup.secret)
      message.success(t('profile.mfa.setup.keyCopied'))
    } catch {
      if (key.current) window.getSelection()?.selectAllChildren(key.current)
      message.warning(t('profile.mfa.setup.keyCopyFailed'))
    }
  }

  const submit = (values: { code: string }) => {
    if (!isTotpCode(values.code)) return refuse('code', t('profile.mfa.validation.codeShape'))
    void run(() => enableMfa(compactCode(values.code)), onEnabled)
  }

  return (
    <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Typography.Paragraph>{t('profile.mfa.setup.scan')}</Typography.Paragraph>
      <div className="profile-mfa__qr">
        <div className="profile-mfa__qr-box">
          <QRCodeSVG
            value={setup.otpauthUri}
            size={192}
            level="M"
            marginSize={0}
            bgColor="#ffffff"
            fgColor="#000000"
            title={t('profile.mfa.setup.qrLabel')}
            data-testid="mfa-qr"
          />
        </div>
      </div>
      <Typography.Text type="secondary">{t('profile.mfa.setup.manualKey')}</Typography.Text>
      <div className="profile-mfa__key-row">
        <code ref={key} className="profile-mfa__key" dir="ltr" data-testid="mfa-secret">
          {groupSecret(setup.secret)}
        </code>
        <Button size="small" icon={<CopyOutlined />} onClick={() => void copyKey()}>
          {t('profile.mfa.setup.copyKey')}
        </Button>
      </div>
      <Typography.Paragraph type="secondary">
        {t('profile.mfa.setup.expiresAt', { when: formatDateTime(setup.expiresAt, language) })}
      </Typography.Paragraph>
      <Typography.Paragraph>{t('profile.mfa.setup.codeIntro')}</Typography.Paragraph>
      <MfaCodeField inputRef={code} />
      <div className="profile-mfa__footer">
        <Button onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button type="primary" htmlType="submit" loading={busy}>
          {t('profile.mfa.setup.submit')}
        </Button>
      </div>
    </Form>
  )
}
