// Administrative reset of a user's two-step verification (API-212, MFA-T04):
// the confirmation the account-actions menu opens for an account whose second
// step is on (users.status.ts — canResetMfa()). It says in plain words what
// happens — the user signs in with the password alone and every device of
// theirs is signed out — and when to use it (a lost phone, after checking who
// is asking), takes the optional reason of the status actions (audit log only)
// and sends ONE POST /api/users/:id/mfa/reset. The answer is never a secret:
// `reset: true` with the number of sessions ended, or `reset: false` when
// nothing was on any more (turned off meanwhile) — either way the drawer
// re-reads the detail, the only source of the «two-step verification» row.
// The parent mounts it per session, so its form never carries an earlier
// reason (KI-049).
import { Alert, App, Form, Input, Modal, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resetUserMfa, STATUS_REASON_MAX_LENGTH } from '../api/users'
import type { UserDetail } from '../api/users'
import { describeUsersFailure, failureMessage } from './users.errors'
import { displayNameOf } from './users.format'

interface UserMfaResetProps {
  user: Pick<UserDetail, 'id' | 'fullName' | 'displayName'>
  /** Cancel, ×, Escape or the mask — ignored while the request runs. */
  onClose: () => void
  /** The server answered (reset, or nothing was on): the modal closes and the detail is re-read. */
  onDone: () => void
  /** The account is gone (`user_not_found`): the detail is re-read while the message stays. */
  onStale: () => void
}

interface ReasonFormValues {
  reason?: string
}

export function UserMfaReset({ user, onClose, onDone, onStale }: UserMfaResetProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm<ReasonFormValues>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (!busy) onClose()
  }

  const confirm = async () => {
    if (busy) return
    let values: ReasonFormValues
    try {
      values = await form.validateFields()
    } catch {
      // The reason is too long: its message sits under the field.
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await resetUserMfa(user.id, values.reason)
      if (!result.reset) message.info(t('users.mfa.reset.notEnabled'))
      else if (result.revokedSessions > 0) message.success(t('users.mfa.reset.done', { sessions: result.revokedSessions }))
      else message.success(t('users.mfa.reset.doneNoSessions'))
      onDone()
    } catch (caught) {
      const failure = describeUsersFailure(caught)
      setError(failureMessage(t, failure))
      setBusy(false)
      if (failure.key === 'users.errors.user_not_found') onStale()
    }
  }

  return (
    <Modal
      open
      title={t('users.status.title', { action: t('users.mfa.reset.action'), name: displayNameOf(user) })}
      okText={t('users.mfa.reset.confirm')}
      okButtonProps={{ danger: true }}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => void confirm()}
      onCancel={close}
    >
      <Typography.Paragraph>{t('users.mfa.reset.hint')}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{t('users.mfa.reset.verify')}</Typography.Paragraph>
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Form<ReasonFormValues> form={form} layout="vertical" requiredMark={false} disabled={busy}>
        <Form.Item
          name="reason"
          label={t('users.status.reason')}
          extra={t('users.status.reasonHint')}
          rules={[{ max: STATUS_REASON_MAX_LENGTH, message: t('users.validation.maxLength', { max: STATUS_REASON_MAX_LENGTH }) }]}
        >
          <Input.TextArea rows={3} maxLength={STATUS_REASON_MAX_LENGTH} showCount />
        </Form.Item>
      </Form>
    </Modal>
  )
}
