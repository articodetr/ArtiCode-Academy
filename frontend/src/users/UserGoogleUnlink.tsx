// Unlinking a user's Google account (PORTAL-04, DELETE /api/users/:id/google-identity):
// the confirmation the account-actions menu opens for an account whose Google
// account is visibly linked (users.status.ts — canUnlinkGoogle()). It says in
// plain words what happens — the link to Google goes, nothing else: the status
// and the password stay — and that an account without a password then needs a
// password-reset link to sign in. ONE DELETE without a body; the answer is the
// detail, which the drawer shows at once (no re-read). The parent mounts it per
// session (KI-049), so a message of an earlier session never shows again.
import { Alert, App, Modal, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { unlinkUserGoogleIdentity } from '../api/users'
import type { UserDetail } from '../api/users'
import { describeUsersFailure, failureMessage } from './users.errors'
import { displayNameOf } from './users.format'

interface UserGoogleUnlinkProps {
  user: Pick<UserDetail, 'id' | 'fullName' | 'displayName'>
  /** Cancel, ×, Escape or the mask — ignored while the request runs. */
  onClose: () => void
  /** The server answered with the detail: the modal closes and the drawer shows it. */
  onDone: (user: UserDetail) => void
  /** The account is gone (`user_not_found`): the detail is re-read while the message stays. */
  onStale: () => void
}

export function UserGoogleUnlink({ user, onClose, onDone, onStale }: UserGoogleUnlinkProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (!busy) onClose()
  }

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await unlinkUserGoogleIdentity(user.id)
      message.success(t('users.google.unlink.done'))
      onDone(updated)
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
      title={t('users.status.title', { action: t('users.google.unlink.action'), name: displayNameOf(user) })}
      okText={t('users.google.unlink.confirm')}
      okButtonProps={{ danger: true }}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => void confirm()}
      onCancel={close}
    >
      <Typography.Paragraph>{t('users.google.unlink.hint')}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{t('users.google.unlink.noPassword')}</Typography.Paragraph>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Modal>
  )
}
