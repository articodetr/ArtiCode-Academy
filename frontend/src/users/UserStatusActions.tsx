// Account actions menu of the user drawer (MOD-03-T14): activate / suspend /
// archive / restore / unlock through POST /api/users/:id/status (API-027) and
// the soft delete through DELETE /api/users/:id (API-028). The menu offers only
// what the state machine, the caller's permissions and the self rule allow
// (users.status.ts); every action is confirmed in a modal with an optional
// reason that goes to the audit log only. Since MFA-T04 the same menu also
// offers «reset two-step verification» (API-212) below a divider — not a status
// action, so it lives beside the state machine (canResetMfa()) and has its own
// confirmation, UserMfaReset. Since PORTAL-04 the same section offers «unlink the
// Google account» (DELETE /api/users/:id/google-identity — canUnlinkGoogle(),
// UserGoogleUnlink), whose answer is the detail.
import {
  CheckCircleOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  DownOutlined,
  InboxOutlined,
  PauseCircleOutlined,
  SafetyOutlined,
  UndoOutlined,
  UnlockOutlined,
} from '@ant-design/icons'
import { Alert, App, Button, Dropdown, Form, Input, Modal, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { changeUserStatus, deleteUser, STATUS_REASON_MAX_LENGTH } from '../api/users'
import type { UserDetail } from '../api/users'
import { useAuth } from '../auth/auth-context'
import { ReasonHint } from './ReasonHint'
import { UserGoogleUnlink } from './UserGoogleUnlink'
import { UserMfaReset } from './UserMfaReset'
import { describeUsersFailure, failureMessage } from './users.errors'
import { displayNameOf } from './users.format'
import { availableAccountActions, canResetMfa, canUnlinkGoogle, signsOut } from './users.status'
import type { AccountAction } from './users.status'

/** Menu key of the two-step verification reset; never an AccountAction. */
const MFA_RESET_KEY = 'mfa_reset'
/** Menu key of the Google unlink; never an AccountAction. */
const GOOGLE_UNLINK_KEY = 'google_unlink'

const ICONS: Readonly<Record<AccountAction, ReactNode>> = {
  activate: <CheckCircleOutlined />,
  suspend: <PauseCircleOutlined />,
  archive: <InboxOutlined />,
  restore: <UndoOutlined />,
  unlock: <UnlockOutlined />,
  delete: <DeleteOutlined />,
}

interface UserStatusActionsProps {
  user: UserDetail
  /** Called with the detail the server returned after the action. */
  onChanged: (user: UserDetail) => void
  /**
   * Called when the shown detail no longer matches the server and must be re-read: the server
   * reported `invalid_transition` (the account changed elsewhere), or the two-step verification
   * reset answered — API-212 returns no detail.
   */
  onStale: () => void
  /** The server removed the account for good (a never-completed self-registration): the drawer closes and the list re-reads. */
  onRemoved?: () => void
}

interface ReasonFormValues {
  reason?: string
}

export function UserStatusActions({ user, onChanged, onStale, onRemoved }: UserStatusActionsProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { user: me, hasPermission } = useAuth()
  const [pending, setPending] = useState<AccountAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form] = Form.useForm<ReasonFormValues>()
  const [resettingMfa, setResettingMfa] = useState(false)
  const [unlinkingGoogle, setUnlinkingGoogle] = useState(false)

  const viewer = { permissions: me?.permissions ?? [], selfId: me?.id ?? null }
  const actions = availableAccountActions(user, { ...viewer, contact: hasPermission('users.read_contact') })
  const offersMfaReset = canResetMfa(user, viewer)
  const offersGoogleUnlink = canUnlinkGoogle(user, viewer)
  // An open confirmation outlives its menu item: a re-read can take the item away while a message still shows.
  if (actions.length === 0 && !offersMfaReset && !offersGoogleUnlink && !resettingMfa && !unlinkingGoogle) return null

  const items: MenuProps['items'] = actions.map((action) => ({
    key: action,
    label: t(`users.status.actions.${action}`),
    icon: ICONS[action],
    danger: signsOut(action),
  }))
  // The actions that change no status, below one divider.
  const extras: NonNullable<MenuProps['items']> = []
  if (offersMfaReset) {
    // Red like the actions that sign out: every device of the user is signed out.
    extras.push({ key: MFA_RESET_KEY, label: t('users.mfa.reset.action'), icon: <SafetyOutlined />, danger: true })
  }
  if (offersGoogleUnlink) {
    extras.push({ key: GOOGLE_UNLINK_KEY, label: t('users.google.unlink.action'), icon: <DisconnectOutlined /> })
  }
  if (extras.length > 0) {
    if (items.length > 0) items.push({ type: 'divider' })
    items.push(...extras)
  }

  const close = () => {
    if (busy) return
    setPending(null)
    setError(null)
    form.resetFields()
  }

  const confirm = async () => {
    if (!pending) return
    const reason = form.getFieldValue('reason') as string | undefined
    const trimmed = reason?.trim() || undefined
    setBusy(true)
    setError(null)
    try {
      const updated =
        pending === 'delete'
          ? await deleteUser(user.id, trimmed ? { reason: trimmed } : undefined)
          : await changeUserStatus(user.id, trimmed ? { action: pending, reason: trimmed } : { action: pending })
      message.success(t(`users.status.done.${pending}`))
      setPending(null)
      form.resetFields()
      // A never-completed self-registration is removed for good: nothing is left to show or re-read.
      if (pending === 'delete' && user.awaitingRegistration === true && onRemoved) onRemoved()
      else onChanged(updated)
    } catch (caught) {
      const failure = describeUsersFailure(caught)
      setError(failureMessage(t, failure))
      if (failure.key.endsWith('invalid_transition')) onStale()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {items.length > 0 ? (
        <Dropdown
          trigger={['click']}
          destroyOnHidden
          menu={{
            items,
            onClick: ({ key, domEvent }) => {
              // Enter on a focused item reaches this handler from the menu's keydown, and the dialog opens and
              // takes the focus right there; the same key's keypress then lands on the dialog's close button and
              // shuts it at once (seen in a real browser — KI-089). Cancelling the keydown cancels that keypress.
              if (domEvent.type === 'keydown') domEvent.preventDefault()
              if (key === MFA_RESET_KEY) {
                setResettingMfa(true)
                return
              }
              if (key === GOOGLE_UNLINK_KEY) {
                setUnlinkingGoogle(true)
                return
              }
              setError(null)
              setPending(key as AccountAction)
            },
          }}
        >
          <Button icon={<DownOutlined />} iconPlacement="end">
            {t('users.status.menu')}
          </Button>
        </Dropdown>
      ) : null}

      <Modal
        open={pending !== null}
        title={pending ? t('users.status.title', { action: t(`users.status.actions.${pending}`), name: displayNameOf(user) }) : ''}
        okText={pending ? t(`users.status.actions.${pending}`) : t('common.save')}
        okButtonProps={{ danger: pending ? signsOut(pending) : false }}
        cancelText={t('common.cancel')}
        confirmLoading={busy}
        onOk={() => void confirm()}
        onCancel={close}
        destroyOnHidden
      >
        {pending ? (
          <Typography.Paragraph>
            {/* A self-registered account its holder never completed is removed for good (the address becomes free again). */}
            {pending === 'delete' && user.awaitingRegistration === true ? t('users.status.hints.deleteForGood') : t(`users.status.hints.${pending}`)}
          </Typography.Paragraph>
        ) : null}
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
        <Form<ReasonFormValues> form={form} layout="vertical" requiredMark={false} disabled={busy}>
          <Form.Item
            name="reason"
            label={t('users.status.reason')}
            extra={<ReasonHint />}
            rules={[{ max: STATUS_REASON_MAX_LENGTH, message: t('users.validation.maxLength', { max: STATUS_REASON_MAX_LENGTH }) }]}
          >
            <Input.TextArea rows={3} maxLength={STATUS_REASON_MAX_LENGTH} showCount />
          </Form.Item>
        </Form>
      </Modal>

      {/* Mounted per session: its reason field never carries an earlier session's text (KI-049). */}
      {resettingMfa ? (
        <UserMfaReset
          user={user}
          onClose={() => setResettingMfa(false)}
          onDone={() => {
            setResettingMfa(false)
            onStale()
          }}
          onStale={onStale}
        />
      ) : null}

      {/* Mounted per session, like the reset: an earlier session's message never shows again. */}
      {unlinkingGoogle ? (
        <UserGoogleUnlink
          user={user}
          onClose={() => setUnlinkingGoogle(false)}
          onDone={(updated) => {
            setUnlinkingGoogle(false)
            onChanged(updated)
          }}
          onStale={onStale}
        />
      ) : null}
    </>
  )
}
