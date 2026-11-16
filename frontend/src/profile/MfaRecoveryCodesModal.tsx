// «New recovery codes» from the two-step verification card (API-210; mounted per session by the card — KI-049):
// the current password and a code of the authenticator app, then the ten new codes shown ONCE (RecoveryCodesList)
// with the reminder that every earlier code has stopped working. Sessions are not touched. From the codes on,
// Escape, the mask and × are off and «close» waits for the tick. The codes live in this component's state only.
// Leaving the page is held like closing (useMfaLeaveGuard): a browser back is refused while the request runs —
// its answer comes once — and asks «leave before saving the recovery codes?» until the tick; a reload or a tab
// close gets the browser's prompt in both states.
import { Alert, Button, Form, Modal, Typography } from 'antd'
import type { InputRef } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { regenerateRecoveryCodes } from '../api/mfa'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { MfaCodeField, MfaPasswordField } from './MfaFields'
import { RecoveryCodesList } from './RecoveryCodesList'
import { compactCode, isTotpCode } from './mfa.format'
import type { MfaField } from './mfa.errors'
import { useMfaLeaveGuard } from './useMfaLeaveGuard'
import { useMfaSubmit } from './useMfaSubmit'
import './mfa.css'

interface MfaRecoveryCodesModalProps {
  onClose: () => void
  /** API-210 answered: the count of unused codes changed. */
  onRegenerated: () => void
  /** The account's state is not what the card shows: close with this message (an i18n key) and re-read. */
  onStale: (messageKey: string) => void
}

interface NewCodes {
  codes: string[]
  /** When the answer arrived (this device's clock) — a line of the downloaded file. */
  generatedAt: string
}

interface FormValues {
  password: string
  code: string
}

export function MfaRecoveryCodesModal({ onClose, onRegenerated, onStale }: MfaRecoveryCodesModalProps) {
  const { t } = useTranslation()
  const [issued, setIssued] = useState<NewCodes | null>(null)
  const [busy, setBusy] = useState(false)
  // The tick under the new codes: they are saved, so the dialog may go.
  const [saved, setSaved] = useState(false)
  // The codes are shown once: from then on only their own «close» ends the dialog; a running request is never left.
  const closable = !busy && issued === null
  // The same two states hold a browser back, a reload and a tab close.
  const leave = useMfaLeaveGuard({ busy, codesUnsaved: issued !== null && !saved, onLeave: onClose })

  return (
    <Modal
      open
      title={t('profile.mfa.regenerate.title')}
      footer={null}
      onCancel={onClose}
      closable={closable}
      keyboard={closable}
      mask={{ closable }}
      destroyOnHidden
    >
      <NavigationBlocker when={leave.guarded} onBlocked={leave.holdNavigation} />
      {issued ? (
        <>
          <Alert type="success" showIcon title={t('profile.mfa.regenerate.done')} style={{ marginBottom: 16 }} />
          <RecoveryCodesList codes={issued.codes} generatedAt={issued.generatedAt} saved={saved} onSavedChange={setSaved} onDone={onClose} />
        </>
      ) : (
        <RegenerateForm
          onBusyChange={setBusy}
          onCancel={onClose}
          onStale={onStale}
          onIssued={(codes) => {
            setIssued({ codes, generatedAt: new Date().toISOString() })
            onRegenerated()
          }}
        />
      )}
    </Modal>
  )
}

interface RegenerateFormProps {
  onBusyChange: (busy: boolean) => void
  onCancel: () => void
  onStale: (messageKey: string) => void
  onIssued: (codes: string[]) => void
}

function RegenerateForm({ onBusyChange, onCancel, onStale, onIssued }: RegenerateFormProps) {
  const { t } = useTranslation()
  const [form] = Form.useForm<FormValues>()
  const password = useRef<InputRef>(null)
  const code = useRef<InputRef>(null)
  const focus = (field: MfaField) => (field === 'password' ? password : code).current?.focus()
  const { busy, error, refuse, run } = useMfaSubmit({ form, focus, onStale, onBusyChange })

  useEffect(() => {
    password.current?.focus()
  }, [])

  const submit = (values: FormValues) => {
    if (!isTotpCode(values.code)) return refuse('code', t('profile.mfa.validation.codeShape'))
    void run(
      () => regenerateRecoveryCodes(values.password, compactCode(values.code)),
      (result) => onIssued(result.recoveryCodes),
    )
  }

  return (
    <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Typography.Paragraph>{t('profile.mfa.regenerate.intro')}</Typography.Paragraph>
      <MfaPasswordField inputRef={password} />
      <MfaCodeField inputRef={code} />
      <div className="profile-mfa__footer">
        <Button onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button type="primary" htmlType="submit" loading={busy}>
          {t('profile.mfa.regenerate.submit')}
        </Button>
      </div>
    </Form>
  )
}
