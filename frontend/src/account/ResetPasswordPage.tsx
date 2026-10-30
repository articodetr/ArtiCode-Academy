// Public password-reset page (MOD-03-T12): /reset-password/:token. There is
// no preview endpoint for reset tokens, so the form shows at once; the confirm
// request (API-020) is the first time the server sees the token. Success
// signs the person in with the fresh session (every older session is gone —
// ADR-033); a dead link shows the reason instead of the form (AC2).
import { Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { confirmPasswordReset } from '../api/account'
import { useAuth } from '../auth/auth-context'
import { describeAccountFailure, malformedLinkFailure } from './account.errors'
import type { AccountFailure } from './account.errors'
import { isTokenShaped } from './account.links'
import { NewPasswordForm } from './NewPasswordForm'
import { DeadLinkNotice, PublicCard } from './PublicCard'

export function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>()
  const { t } = useTranslation()
  const { status, adoptSession } = useAuth()
  const navigate = useNavigate()
  const [failure, setFailure] = useState<AccountFailure | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const dead = failure ?? (isTokenShaped(token) ? null : malformedLinkFailure('reset'))

  const onSubmit = async (password: string) => {
    if (!token) return
    setSubmitting(true)
    setFormError(null)
    try {
      const user = adoptSession(await confirmPasswordReset(token, password))
      // `replace`: the history entry that carries the token is dropped.
      navigate(user.mustChangePassword ? '/profile' : '/', { replace: true })
    } catch (error) {
      const described = describeAccountFailure(error, 'reset')
      if (described.terminal) setFailure(described)
      else setFormError(t(described.key, { ...described.params }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PublicCard subtitle={t('account.reset.subtitle')}>
      {dead ? (
        <DeadLinkNotice message={t(dead.key)} />
      ) : (
        <>
          <Typography.Paragraph>{t('account.reset.intro')}</Typography.Paragraph>
          <NewPasswordForm
            submitLabel={t('account.reset.submit')}
            submittingLabel={t('account.reset.submitting')}
            submitting={submitting}
            disabled={status === 'loading'}
            error={formError}
            onSubmit={onSubmit}
          />
        </>
      )}
    </PublicCard>
  )
}
