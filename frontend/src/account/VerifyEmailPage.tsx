// Public e-mail confirmation page (LR-01-T02 — J-F54): /verify-email/:token,
// the link of the confirmation e-mail (API-165 sends it to the address itself
// — D-R78). Like /reset-password/:token (MOD-03-T12): a token that does not
// have the shape of one is a dead link without a request; otherwise the page
// explains and the button sends API-166 (public — no access token, no refresh)
// — the first time the server sees the token. Success opens no session (the
// link may be opened on another device): it says the address is confirmed and
// offers the profile to a signed-in visitor, sign-in to anyone else. A link
// that can never work (verification_invalid, verification_expired) shows the
// reason without the button; a throttled or failed request keeps it.
import { Alert, Button, Flex, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { confirmEmailVerification } from '../api/emailVerification'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import { describeVerificationConfirmFailure, malformedVerificationLink } from './emailVerification.errors'
import type { VerificationFailure } from './emailVerification.errors'
import { isTokenShaped } from './account.links'
import { DeadLinkNotice, PublicCard } from './PublicCard'

export function VerifyEmailPage() {
  const { token } = useParams<{ token: string }>()
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { status } = useAuth()
  const navigate = useNavigate()
  const [failure, setFailure] = useState<VerificationFailure | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null)

  const dead = failure ?? (isTokenShaped(token) ? null : malformedVerificationLink())
  const signedIn = status === 'authenticated'

  const confirm = async () => {
    if (!token || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const { emailVerifiedAt } = await confirmEmailVerification(token)
      setConfirmedAt(emailVerifiedAt)
    } catch (caught) {
      const described = describeVerificationConfirmFailure(caught)
      if (described.terminal) setFailure(described)
      else setError(t(described.key, described.params))
    } finally {
      setSubmitting(false)
    }
  }

  const goOn = signedIn ? (
    <Button type="primary" onClick={() => navigate('/profile', { replace: true })}>
      {t('verifyEmail.goToProfile')}
    </Button>
  ) : (
    <Button type="primary" onClick={() => navigate('/login', { replace: true })}>
      {t('account.goToLogin')}
    </Button>
  )

  return (
    <PublicCard subtitle={t('verifyEmail.subtitle')}>
      {confirmedAt ? (
        <>
          <Alert
            type="success"
            showIcon
            title={t('verifyEmail.done')}
            description={
              <>
                <div>{t('verifyEmail.doneAt', { date: formatDateTime(confirmedAt, language) })}</div>
                <div>{t('verifyEmail.doneHint')}</div>
              </>
            }
          />
          <Flex justify="center" style={{ marginTop: 16 }}>
            {goOn}
          </Flex>
        </>
      ) : dead ? (
        <>
          <DeadLinkNotice message={t(dead.key)} />
          {signedIn ? (
            <Flex justify="center" style={{ marginTop: 8 }}>
              <Button type="link" onClick={() => navigate('/profile', { replace: true })}>
                {t('verifyEmail.goToProfile')}
              </Button>
            </Flex>
          ) : null}
        </>
      ) : (
        <>
          <Typography.Paragraph>{t('verifyEmail.intro')}</Typography.Paragraph>
          {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
          <Button type="primary" block loading={submitting} onClick={() => void confirm()}>
            {t('verifyEmail.submit')}
          </Button>
        </>
      )}
    </PublicCard>
  )
}
