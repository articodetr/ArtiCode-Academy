// «إضافة طالب» / «إضافة مدرس» in one step: full name, e-mail and a phone, then
// POST /api/users (API-014) — the server gives the kind's role and profile and
// creates the account `invited` — and at once the invitation of API-015, whose
// link the page shows once (IssuedLinkModal). The account exists even when the
// invitation fails; the caller is told which happened. The token is handed to
// the caller in memory only: never a URL, storage, a React key or the console.
import { Alert, Button, Flex, Form, Input, Modal, Typography } from 'antd'
import type { FormRule } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { issueInvitation } from '../api/account'
import type { IssuedLink } from '../api/account'
import { createUser } from '../api/users'
import type { UserDetail } from '../api/users'
import { describeUsersFailure, failureMessage } from './users.errors'
import type { UsersFailure } from './users.errors'
import { FULL_NAME_MAX_LENGTH, FULL_NAME_MIN_LENGTH, PHONE_REQUIRED, buildQuickCreateInput, phoneProblem } from './users.quickCreate'
import type { QuickCreateKind, QuickCreateValues } from './users.quickCreate'
import { EMAIL_MAX_LENGTH } from './users.validation'

/** What happened after the account was created: the issued invitation, or why it could not be issued. */
export type QuickCreateOutcome =
  | { kind: QuickCreateKind; user: UserDetail; invitation: IssuedLink; invitationFailure: null }
  | { kind: QuickCreateKind; user: UserDetail; invitation: null; invitationFailure: UsersFailure }

interface QuickCreateUserModalProps {
  /** The kind to create; null keeps the modal closed. */
  kind: QuickCreateKind | null
  onClose: () => void
  /** Called once the account exists (the modal does not close itself). */
  onCreated: (outcome: QuickCreateOutcome) => void
}

/** The form fields whose server errors are shown under the field rather than above the form. */
const FORM_FIELDS = new Set(['fullName', 'email', 'phone'])

export function QuickCreateUserModal({ kind, onClose, onCreated }: QuickCreateUserModalProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  // The last kind shown, so the closing animation keeps its title and form instead of an empty box.
  const [lastKind, setLastKind] = useState<QuickCreateKind | null>(kind)
  if (kind !== null && kind !== lastKind) setLastKind(kind)
  const shown = kind ?? lastKind
  return (
    <Modal
      open={kind !== null}
      onCancel={() => (busy ? undefined : onClose())}
      title={shown ? t(`users.quick.title.${shown}`) : null}
      footer={null}
      width={480}
      // No close while the request runs (the account may already exist), and no mask click that loses the typing.
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: false }}
      destroyOnHidden
    >
      {/* Mounted per opening (destroyOnHidden) and per kind (a reopening during the close animation): each starts
          from an empty form (KI-049). */}
      {shown ? <QuickCreateBody key={shown} kind={shown} busy={busy} setBusy={setBusy} onClose={onClose} onCreated={onCreated} /> : null}
    </Modal>
  )
}

interface QuickCreateBodyProps {
  kind: QuickCreateKind
  busy: boolean
  setBusy: (busy: boolean) => void
  onClose: () => void
  onCreated: (outcome: QuickCreateOutcome) => void
}

function QuickCreateBody({ kind, busy, setBusy, onClose, onCreated }: QuickCreateBodyProps) {
  const { t } = useTranslation()
  const [form] = Form.useForm<QuickCreateValues>()
  const [failure, setFailure] = useState<string | null>(null)
  // A second Enter or click before the first request settles must not create a second account.
  const inFlight = useRef(false)
  const phoneRequired = PHONE_REQUIRED[kind]

  const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : value)
  const fullNameRules: FormRule[] = [
    { required: true, whitespace: true, message: t('users.validation.fullName') },
    { min: FULL_NAME_MIN_LENGTH, max: FULL_NAME_MAX_LENGTH, transform: trim, message: t('users.validation.fullName') },
  ]
  const emailRules: FormRule[] = [
    { required: true, whitespace: true, message: t('users.quick.validation.emailRequired') },
    { type: 'email', transform: trim, message: t('users.validation.email') },
    { max: EMAIL_MAX_LENGTH, transform: trim, message: t('users.validation.maxLength', { max: EMAIL_MAX_LENGTH }) },
  ]
  const phoneRules: FormRule[] = [
    {
      validator: (_rule, value: unknown) => {
        const problem = phoneProblem(kind, value)
        if (problem === 'required') return Promise.reject(new Error(t('users.quick.validation.phoneRequired')))
        if (problem === 'format') return Promise.reject(new Error(t('users.quick.validation.phone')))
        return Promise.resolve()
      },
    },
  ]

  const submit = async (values: QuickCreateValues) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setFailure(null)
    try {
      let user: UserDetail
      try {
        user = await createUser(buildQuickCreateInput(kind, values))
      } catch (error) {
        const described = describeUsersFailure(error)
        const text = failureMessage(t, described)
        const field = described.field
        if (field && field.length === 1 && FORM_FIELDS.has(field[0]!)) form.setFields([{ name: field[0] as keyof QuickCreateValues, errors: [text] }])
        else setFailure(text)
        return
      }
      // The account exists from here on: whatever the invitation answers, the caller is told about both.
      let outcome: QuickCreateOutcome
      try {
        outcome = { kind, user, invitation: await issueInvitation(user.id), invitationFailure: null }
      } catch (error) {
        outcome = { kind, user, invitation: null, invitationFailure: describeUsersFailure(error) }
      }
      onCreated(outcome)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t(`users.quick.hint.${kind}`)}
      </Typography.Paragraph>

      {failure ? <Alert type="error" showIcon title={failure} style={{ marginBottom: 16 }} /> : null}

      <Form<QuickCreateValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={busy}
        onFinish={(values) => void submit(values)}
      >
        <Form.Item name="fullName" label={t('users.fields.fullName')} validateFirst rules={fullNameRules}>
          <Input maxLength={FULL_NAME_MAX_LENGTH} autoComplete="off" />
        </Form.Item>
        <Form.Item name="email" label={t('users.fields.email')} validateFirst rules={emailRules}>
          <Input type="email" dir="ltr" maxLength={EMAIL_MAX_LENGTH} autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="phone"
          label={
            phoneRequired ? (
              t('users.quick.fields.phone')
            ) : (
              <span>
                {t('users.quick.fields.backupPhone')}{' '}
                <Typography.Text type="secondary">({t('users.quick.optional')})</Typography.Text>
              </span>
            )
          }
          rules={phoneRules}
        >
          {/* `dir="ltr"`: the shared rule of index.css lays an LTR antd field out left to right (KI-111). */}
          <Input dir="ltr" inputMode="tel" placeholder="+9665XXXXXXXX" autoComplete="off" />
        </Form.Item>

        <Flex justify="flex-end" gap={8} wrap>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="primary" htmlType="submit" loading={busy}>
            {t(`users.quick.submit.${kind}`)}
          </Button>
        </Flex>
      </Form>
    </>
  )
}
