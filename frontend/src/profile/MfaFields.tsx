// The three inputs the two-step verification dialogs share (API-207..API-210): the current password, a code of
// the authenticator app and a recovery code — each a Form.Item named after its body field (`password`, `code`,
// `recoveryCode`). Only «required» is a rule: the shape of a code is checked on submit (mfa.format.ts), so nothing
// nags while the digits are still being typed, and a message the server put on a field goes with the next key.
// Nothing typed here is stored anywhere: the values live in the dialog's form and go with it.
import { Form, Input } from 'antd'
import type { InputRef } from 'antd'
import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { MFA_CODE_MAX_LENGTH, MFA_PASSWORD_MAX_LENGTH, MFA_RECOVERY_CODE_MAX_LENGTH } from '../api/mfa'
import './mfa.css'

interface MfaFieldProps {
  /** Lets the dialog put the cursor back after a refusal. */
  inputRef?: Ref<InputRef>
}

export function MfaPasswordField({ inputRef }: MfaFieldProps) {
  const { t } = useTranslation()
  return (
    <Form.Item
      name="password"
      label={t('profile.mfa.fields.password')}
      rules={[{ required: true, message: t('profile.mfa.validation.passwordRequired') }]}
    >
      <Input.Password ref={inputRef} autoComplete="current-password" maxLength={MFA_PASSWORD_MAX_LENGTH} />
    </Form.Item>
  )
}

export function MfaCodeField({ inputRef }: MfaFieldProps) {
  const { t } = useTranslation()
  return (
    <Form.Item
      name="code"
      label={t('profile.mfa.fields.code')}
      rules={[{ required: true, whitespace: true, message: t('profile.mfa.validation.codeRequired') }]}
    >
      <Input
        ref={inputRef}
        className="profile-mfa__code-input"
        dir="ltr"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCorrect="off"
        spellCheck={false}
        maxLength={MFA_CODE_MAX_LENGTH}
      />
    </Form.Item>
  )
}

export function MfaRecoveryCodeField({ inputRef }: MfaFieldProps) {
  const { t } = useTranslation()
  return (
    <Form.Item
      name="recoveryCode"
      label={t('profile.mfa.fields.recoveryCode')}
      rules={[{ required: true, whitespace: true, message: t('profile.mfa.validation.recoveryCodeRequired') }]}
    >
      <Input
        ref={inputRef}
        className="profile-mfa__code-input profile-mfa__code-input--recovery"
        dir="ltr"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        placeholder="XXXXX-XXXXX"
        maxLength={MFA_RECOVERY_CODE_MAX_LENGTH}
      />
    </Form.Item>
  )
}
