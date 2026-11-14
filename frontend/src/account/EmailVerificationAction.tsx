// The profile's "confirm my e-mail" action (LR-01-T02, API-165).
//
// Whether the address is already confirmed is not in the session user
// (AuthUserDto of /api/auth/me carries no `emailVerifiedAt`). The only screen
// field that holds it is the user detail of API-013, and it is filled only for
// a reader holding `users.read` + `users.read_contact` (D-R07). So:
//   - with both keys, the detail of one's own account is read once and the
//     action shows only while the address is unconfirmed;
//   - without them the state is unknown: the action shows for every account
//     with an address, and the server answers `email_already_verified` when
//     there is nothing to do.
import { Alert, Button, Space, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { requestEmailVerification } from '../api/account'
import { getUser } from '../api/users'
import type { AuthUser } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import { describeVerificationRequestFailure } from './account.errors'
import { canReadOwnVerification } from './account.links'

type Known = { state: 'verified'; at: string | null } | { state: 'unverified' } | { state: 'unknown' }

interface Outcome {
  type: 'success' | 'info' | 'warning' | 'error'
  text: string
}

export function EmailVerificationAction({ user }: { user: Pick<AuthUser, 'id' | 'email' | 'permissions'> }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const readable = Boolean(user.email) && canReadOwnVerification(user)
  // Keyed by the account and address, so a stale answer for another account never shows.
  const lookupKey = readable ? `${user.id}:${user.email}` : null
  const [lookup, setLookup] = useState<{ key: string; known: Known } | null>(null)
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [alreadyVerified, setAlreadyVerified] = useState(false)

  useEffect(() => {
    if (!lookupKey) return
    const controller = new AbortController()
    getUser(user.id, { signal: controller.signal })
      .then((detail) => {
        const known: Known = detail.emailVerifiedAt
          ? { state: 'verified', at: detail.emailVerifiedAt }
          : detail.email
            ? { state: 'unverified' }
            : { state: 'unknown' }
        setLookup({ key: lookupKey, known })
      })
      .catch(() => {
        if (!controller.signal.aborted) setLookup({ key: lookupKey, known: { state: 'unknown' } })
      })
    return () => controller.abort()
  }, [lookupKey, user.id])

  if (!user.email) return null

  const known: Known | null = alreadyVerified
    ? { state: 'verified', at: null }
    : !readable
      ? { state: 'unknown' }
      : lookup?.key === lookupKey
        ? lookup.known
        : null

  if (known === null) return null // still reading — no flash of an action that may not apply

  const send = async () => {
    setSending(true)
    setOutcome(null)
    try {
      const answer = await requestEmailVerification()
      setOutcome(
        answer.delivery.status === 'failed'
          ? { type: 'error', text: t('emailVerification.request.deliveryFailed') }
          : {
              type: 'success',
              text: t('emailVerification.request.sent', {
                email: user.email,
                expiresAt: formatDateTime(answer.expiresAt, language),
              }),
            },
      )
    } catch (error) {
      const failure = describeVerificationRequestFailure(error)
      if (failure.key === 'emailVerification.errors.email_already_verified') setAlreadyVerified(true)
      setOutcome({ type: failure.type, text: t(failure.key) })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="profile-email-verification" style={{ marginTop: 16 }}>
      <Space size={8} wrap style={{ marginBottom: 8 }}>
        <Typography.Text strong>{t('emailVerification.status.label')}</Typography.Text>
        {known.state === 'verified' ? (
          <Tag color="green">
            {known.at
              ? t('emailVerification.status.verified', { date: formatDateTime(known.at, language) })
              : t('emailVerification.status.confirmed')}
          </Tag>
        ) : known.state === 'unverified' ? (
          <Tag color="gold">{t('emailVerification.status.unverified')}</Tag>
        ) : null}
      </Space>
      {outcome ? <Alert type={outcome.type} showIcon title={outcome.text} style={{ marginBottom: 12 }} /> : null}
      {known.state === 'verified' ? null : (
        <>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            {known.state === 'unknown' ? t('emailVerification.request.hintUnknown') : t('emailVerification.request.hint')}
          </Typography.Paragraph>
          <Button loading={sending} onClick={() => void send()}>
            {sending ? t('emailVerification.request.sending') : t('emailVerification.request.button')}
          </Button>
        </>
      )}
    </div>
  )
}
