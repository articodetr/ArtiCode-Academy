// Public password-reset page (MOD-03-T12): /reset-password/:token. There is
// no preview endpoint for reset tokens, so the form shows at once; the confirm
// request (API-020) is the first time the server sees the token. Success
// signs the person in with the fresh session (every older session is gone —
// ADR-033); a dead link shows the reason instead of the form (AC2).
//
// An account with two-step verification gets no session from API-020 but the
// challenge of the second step: the password IS changed and the link used up,
// so the page says so and finishes the sign-in with the same step as the
// sign-in page (API-211). When that step ends without a session the only way
// on is the sign-in page — with the new password.
import { Alert, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { confirmPasswordReset } from '../api/account'
import { isMfaChallenge } from '../api/auth'
import type { MfaChallenge } from '../api/auth'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/auth-context'
import type { AuthUser } from '../auth/auth-context'
import { MfaChallengeStep } from '../auth/MfaChallengeStep'
import type { MfaRestartReason, SignInNotice } from '../auth/mfa.signIn'
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
  // The password is changed and the second step is still to come (two-step verification).
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null)

  const dead = failure ?? (isTokenShaped(token) ? null : malformedLinkFailure('reset'))

  // `replace`: the history entry that carries the token is dropped.
  const enter = (user: AuthUser) => {
    navigate(user.mustChangePassword ? '/profile' : '/', { replace: true })
  }

  const onSubmit = async (password: string) => {
    if (!token) return
    setSubmitting(true)
    setFormError(null)
    try {
      const result = await confirmPasswordReset(token, password)
      if (isMfaChallenge(result)) setChallenge(result)
      else enter(adoptSession(result))
    } catch (error) {
      // 503 mfa_unavailable is thrown AFTER the reset committed (the account has two-step verification and
      // the server cannot check it right now): the new password stands and the link is used up, so the
      // form must not be offered again — say what happened and point to the sign-in page.
      const described: AccountFailure =
        error instanceof ApiError && error.code === 'mfa_unavailable'
          ? { key: 'login.mfa.passwordChangedUnavailable', terminal: true }
          : describeAccountFailure(error, 'reset')
      if (described.terminal) setFailure(described)
      else setFormError(t(described.key, { ...described.params }))
    } finally {
      setSubmitting(false)
    }
  }

  // The reset link is used up, so the step cannot start again from this page:
  // the sign-in page takes over and says that the new password is the one to use.
  const toSignIn = (reason: MfaRestartReason) => {
    const notice: SignInNotice = reason === 'ended' ? 'password_changed_step_ended' : 'password_changed'
    navigate('/login', { replace: true, state: { notice } })
  }

  if (challenge) {
    return (
      <PublicCard subtitle={t('login.mfa.subtitle')}>
        <Alert type="success" showIcon title={t('login.mfa.passwordChanged')} style={{ marginBottom: 16 }} />
        <MfaChallengeStep challenge={challenge} onSuccess={enter} onRestart={toSignIn} />
      </PublicCard>
    )
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
