// Public e-mail confirmation page (LR-01-T02): /verify-email/:token, the link
// of the e-mail API-165 sends. The token is confirmed (API-166) only when the
// person presses the button — never on load — because mail clients and
// security scanners open links on their own, and a GET-triggered confirmation
// would let them consume the one-time token. The token stays in the URL and in
// that one request; it is never stored. API-166 opens no session.
import { Alert, Button, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { confirmEmailVerification } from '../api/account'
import { useAuth } from '../auth/auth-context'
import { describeVerificationConfirmFailure, malformedVerificationFailure } from './account.errors'
import type { AccountFailure } from './account.errors'
import { isTokenShaped } from './account.links'
import { DeadLinkNotice, PublicCard } from './PublicCard'

export function VerifyEmailPage() {
  const { token } = useParams<{ token: string }>()
  const { t } = useTranslation()
  const { status } = useAuth()
  const [failure, setFailure] = useState<AccountFailure | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const dead = failure?.terminal ? failure : isTokenShaped(token) ? null : malformedVerificationFailure()

  const onConfirm = async () => {
    if (!token || confirming) return
    setConfirming(true)
    setFailure(null)
    try {
      await confirmEmailVerification(token)
      setConfirmed(true)
    } catch (error) {
      setFailure(describeVerificationConfirmFailure(error))
    } finally {
      setConfirming(false)
    }
  }

  let body
  if (confirmed) {
    const signedIn = status === 'authenticated'
    body = (
      <>
        <Alert type="success" showIcon title={t('emailVerification.page.success')} />
        <div className="public-page__actions">
          <Link to={signedIn ? '/' : '/login'} replace>
            <Button type="primary">{signedIn ? t('emailVerification.page.goToApp') : t('account.goToLogin')}</Button>
          </Link>
        </div>
      </>
    )
  } else if (dead) {
    body = <DeadLinkNotice message={t(dead.key)} />
  } else {
    body = (
      <>
        <Typography.Paragraph>{t('emailVerification.page.intro')}</Typography.Paragraph>
        {failure ? <Alert type="error" showIcon title={t(failure.key)} style={{ marginBottom: 16 }} /> : null}
        <Button type="primary" size="large" block loading={confirming} onClick={() => void onConfirm()}>
          {confirming ? t('emailVerification.page.confirming') : t('emailVerification.page.confirm')}
        </Button>
      </>
    )
  }

  return <PublicCard subtitle={t('emailVerification.page.subtitle')}>{body}</PublicCard>
}
