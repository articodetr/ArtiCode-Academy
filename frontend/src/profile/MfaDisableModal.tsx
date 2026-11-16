// Turning two-step verification off from «حسابي» (API-209; mounted per session by the card — KI-049): the current
// password and exactly ONE second factor — a code of the authenticator app, or (behind a link, for someone who lost
// the app) an unused recovery code, which is spent. A plain warning says what is lost: the password alone protects
// the account afterwards, the recovery codes go and the other devices are signed out. Nothing typed is stored.
import { Alert, Button, Form, Modal } from 'antd'
import type { InputRef } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { disableMfa } from '../api/mfa'
import type { MfaDisableInput } from '../api/mfa'
import { MfaCodeField, MfaPasswordField, MfaRecoveryCodeField } from './MfaFields'
import type { MfaFactor, MfaField } from './mfa.errors'
import { compactCode, isTotpCode, normalizeRecoveryCode } from './mfa.format'
import { useMfaSubmit } from './useMfaSubmit'
import './mfa.css'

interface MfaDisableModalProps {
  onClose: () => void
  /** API-209 answered: it is off; `revokedSessions` other sessions of the caller were signed out. */
  onDisabled: (revokedSessions: number) => void
  /** The account's state is not what the card shows: close with this message (an i18n key) and re-read. */
  onStale: (messageKey: string) => void
}

interface FormValues {
  password: string
  code?: string
  recoveryCode?: string
}

export function MfaDisableModal({ onClose, onDisabled, onStale }: MfaDisableModalProps) {
  const { t } = useTranslation()
  const [form] = Form.useForm<FormValues>()
  // Which second factor the form asks for; the other field is not rendered and its value is dropped.
  const [factor, setFactor] = useState<MfaFactor>('code')
  const password = useRef<InputRef>(null)
  const second = useRef<InputRef>(null)
  const focus = (field: MfaField) => (field === 'password' ? password : second).current?.focus()
  const { busy, error, refuse, run } = useMfaSubmit({ form, focus, onStale })

  useEffect(() => {
    password.current?.focus()
  }, [])

  /** The other second factor: what was typed for the first is dropped, and the cursor goes to the new field. */
  const switchFactor = () => {
    form.setFieldsValue({ code: undefined, recoveryCode: undefined })
    flushSync(() => setFactor((current) => (current === 'code' ? 'recoveryCode' : 'code')))
    second.current?.focus()
  }

  const submit = (values: FormValues) => {
    let input: MfaDisableInput
    if (factor === 'code') {
      const code = values.code ?? ''
      if (!isTotpCode(code)) return refuse('code', t('profile.mfa.validation.codeShape'))
      input = { password: values.password, code: compactCode(code) }
    } else {
      const recoveryCode = normalizeRecoveryCode(values.recoveryCode ?? '')
      if (recoveryCode === null) return refuse('recoveryCode', t('profile.mfa.validation.recoveryCodeShape'))
      input = { password: values.password, recoveryCode }
    }
    void run(() => disableMfa(input), (result) => onDisabled(result.revokedSessions), factor)
  }

  return (
    <Modal
      open
      title={t('profile.mfa.disable.title')}
      footer={null}
      onCancel={onClose}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
        <Alert type="warning" showIcon title={t('profile.mfa.disable.warning')} style={{ marginBottom: 16 }} />
        {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
        <MfaPasswordField inputRef={password} />
        {factor === 'code' ? <MfaCodeField inputRef={second} /> : <MfaRecoveryCodeField inputRef={second} />}
        <Button type="link" style={{ padding: 0 }} disabled={busy} onClick={switchFactor}>
          {t(factor === 'code' ? 'profile.mfa.disable.useRecoveryCode' : 'profile.mfa.disable.useCode')}
        </Button>
        <div className="profile-mfa__footer">
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="primary" danger htmlType="submit" loading={busy}>
            {t('profile.mfa.disable.submit')}
          </Button>
        </div>
      </Form>
    </Modal>
  )
}
