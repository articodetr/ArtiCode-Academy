// Public invitation page (MOD-03-T12): /invite/:token. Reads the preview
// (API-016), lets the person choose a password, accepts the invitation
// (API-017) and signs them in with the session the server returns. The token
// exists only in the URL and in the two requests of its own route; it is never
// stored (AC1). A dead link shows the reason instead of the form (AC2).
import { Alert, Button, Descriptions, Flex, Space, Spin, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { acceptInvitation, previewInvitation } from '../api/account'
import type { InvitationPreview } from '../api/account'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime, roleLabel } from '../users/users.format'
import { describeAccountFailure, malformedLinkFailure } from './account.errors'
import type { AccountFailure } from './account.errors'
import { isTokenShaped } from './account.links'
import { NewPasswordForm } from './NewPasswordForm'
import { DeadLinkNotice, PublicCard } from './PublicCard'

export function InvitationPage() {
  const { token } = useParams<{ token: string }>()
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { status, adoptSession } = useAuth()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [failure, setFailure] = useState<AccountFailure | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // A malformed token is dead before any request; a server verdict replaces it.
  const dead = failure ?? (isTokenShaped(token) ? null : malformedLinkFailure('invitation'))

  useEffect(() => {
    if (!isTokenShaped(token)) return
    const controller = new AbortController()
    previewInvitation(token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPreview(result)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFailure(describeAccountFailure(error, 'invitation'))
      })
    return () => controller.abort()
  }, [token, attempt])

  const onSubmit = async (password: string) => {
    if (!token) return
    setSubmitting(true)
    setFormError(null)
    try {
      const user = adoptSession(await acceptInvitation(token, password))
      // `replace`: the history entry that carries the token is dropped.
      navigate(user.mustChangePassword ? '/profile' : '/', { replace: true })
    } catch (error) {
      const described = describeAccountFailure(error, 'invitation')
      if (described.terminal) setFailure(described)
      else setFormError(t(described.key, { ...described.params }))
    } finally {
      setSubmitting(false)
    }
  }

  const retry = () => {
    setFailure(null)
    setAttempt((count) => count + 1)
  }

  let body
  if (dead?.terminal) {
    body = <DeadLinkNotice message={t(dead.key)} />
  } else if (dead) {
    body = (
      <>
        <Alert type="error" showIcon message={t('account.invitation.loadFailed')} description={t(dead.key)} />
        <Flex justify="center" style={{ marginTop: 16 }}>
          <Button onClick={retry}>{t('account.invitation.retry')}</Button>
        </Flex>
      </>
    )
  } else if (!preview) {
    body = (
      <Flex justify="center" style={{ padding: 24 }}>
        <Spin size="large" />
      </Flex>
    )
  } else {
    body = (
      <>
        <Typography.Paragraph>{t('account.invitation.intro')}</Typography.Paragraph>
        <Descriptions
          column={1}
          size="small"
          style={{ marginBottom: 16 }}
          items={[
            { key: 'name', label: t('account.invitation.name'), children: preview.fullName },
            ...(preview.displayName
              ? [{ key: 'displayName', label: t('users.fields.displayName'), children: preview.displayName }]
              : []),
            ...(preview.email
              ? [{ key: 'email', label: t('account.invitation.email'), children: <span dir="ltr">{preview.email}</span> }]
              : []),
            ...(preview.username
              ? [{ key: 'username', label: t('account.invitation.username'), children: <span dir="ltr">{preview.username}</span> }]
              : []),
            {
              key: 'roles',
              label: t('account.invitation.roles'),
              children:
                preview.roles.length > 0 ? (
                  <Space size={[4, 4]} wrap>
                    {preview.roles.map((key) => (
                      <Tag key={key} color="blue">
                        {roleLabel(key, t)}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  '—'
                ),
            },
            { key: 'expiresAt', label: t('account.invitation.expiresAt'), children: formatDateTime(preview.expiresAt, language) },
          ]}
        />
        <NewPasswordForm
          submitLabel={t('account.invitation.submit')}
          submittingLabel={t('account.invitation.submitting')}
          submitting={submitting}
          disabled={status === 'loading'}
          error={formError}
          onSubmit={onSubmit}
        />
      </>
    )
  }

  return <PublicCard subtitle={t('account.invitation.subtitle')}>{body}</PublicCard>
}
