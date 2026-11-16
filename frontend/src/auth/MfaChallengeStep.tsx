// The second step of a sign-in for an account with two-step verification
// (MFA-UI part A): the password step (API-005) or a confirmed password reset
// (API-020) answered a challenge instead of a session, and this form finishes
// the sign-in with the authenticator's code or a recovery code (API-211,
// through `completeMfaLogin` of the auth context). Used by the sign-in page and
// the password-reset page inside their own card.
//
// One mount per challenge: a page renders the step the moment it gets a
// challenge, only while it holds it, and never swaps one challenge for another
// under it — the step's clock and its count of wrong codes start when it
// mounts. The challenge, the typed code and the recovery code live in memory
// only — never in storage, the URL, a React key or the console — and are gone
// when the step unmounts.
import { Alert, Button, Flex, Form, Input, Typography } from 'antd'
import type { InputRef } from 'antd'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MfaChallenge } from '../api/auth'
import { useAuth } from './auth-context'
import type { AuthUser } from './auth-context'
import {
  MFA_CHALLENGE_TTL_MS,
  RECOVERY_CODE_PLACEHOLDER,
  RECOVERY_INPUT_MAX_LENGTH,
  TOTP_INPUT_MAX_LENGTH,
  challengeExhausted,
  describeMfaSignInFailure,
  expiryLine,
  minutesLeftOf,
  normalizeRecoveryCode,
  normalizeTotpCode,
  stepTimeLeftMs,
} from './mfa.signIn'
import type { MfaFactorKind, MfaRestartLock, MfaRestartReason, MfaSignInFailure } from './mfa.signIn'
import '../pages/LoginPage.css'

interface MfaChallengeStepProps {
  /** What API-005 or API-020 answered instead of a session. Mount the step the moment it arrives. */
  challenge: MfaChallenge
  /** The second factor was accepted: the visitor is signed in (the auth context already says so). */
  onSuccess: (user: AuthUser) => void
  /**
   * The step is over without a session and the password is needed again:
   * `back` — the visitor asked for it (the link, or the button of the expired step);
   * `ended` — the challenge is over (the server refused it as expired or used, or its five wrong
   *   codes are spent) and the password form should say so;
   * `locked` — the account is locked, so no code can be accepted before the lock ends; `lock`
   *   carries its minutes when the server named them.
   */
  onRestart: (reason: MfaRestartReason, lock?: MfaRestartLock) => void
}

interface StepValues {
  code?: string
  recoveryCode?: string
}

/** How often the time left is re-read; the line itself only changes once a minute. */
const CLOCK_TICK_MS = 1000

export function MfaChallengeStep({ challenge, onSuccess, onRestart }: MfaChallengeStepProps) {
  const { t } = useTranslation()
  const { completeMfaLogin } = useAuth()
  const [form] = Form.useForm<StepValues>()
  const [factor, setFactor] = useState<MfaFactorKind>('code')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<MfaSignInFailure | null>(null)
  // Bumped whenever the field should take the focus back (a refused code).
  const [focusRequest, setFocusRequest] = useState(0)
  const inputRef = useRef<InputRef>(null)
  // A second Enter before the form is disabled must not send the code twice:
  // every wrong answer counts against the challenge and the account.
  const busy = useRef(false)
  // Wrong codes the server has counted against this challenge (one mount = one challenge).
  const wrongCodes = useRef(0)

  // The step's own clock: the server's five minutes counted from the moment the step appeared, with
  // this device's clock as a stopwatch only. `challenge.expiresAt` is not read — a device a few
  // minutes fast would call a fresh challenge expired within seconds (see `stepTimeLeftMs`).
  // A courtesy to the visitor; the server stays the judge.
  const [startedAt] = useState(() => Date.now())
  const [minutesLeft, setMinutesLeft] = useState(() => minutesLeftOf(MFA_CHALLENGE_TTL_MS))
  useEffect(() => {
    const timer = window.setInterval(() => {
      const left = minutesLeftOf(stepTimeLeftMs(startedAt, Date.now()))
      setMinutesLeft(left)
      if (left === 0) window.clearInterval(timer)
    }, CLOCK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [startedAt])

  // The field of the chosen factor has the focus: at first, after switching the
  // factor, and again after a refused code — in the commit that re-enables the form.
  useEffect(() => {
    inputRef.current?.focus()
  }, [factor, focusRequest])

  // A request already on its way is allowed to finish: its answer decides.
  const expired = minutesLeft === 0 && !submitting
  const signInAgainRef = useRef<HTMLButtonElement>(null)
  const expiredMessageId = useId()
  // The expired view replaces the form the focus was in, which would leave it on <body>: a keyboard
  // or screen-reader user would be nowhere. The one way on takes it — the button is described by
  // the message, so both are read. A focus that is somewhere else on the page is left alone.
  useEffect(() => {
    if (!expired) return
    const active = document.activeElement
    if (active === null || active === document.body || !active.isConnected) signInAgainRef.current?.focus()
  }, [expired])

  const submit = async (values: StepValues) => {
    if (busy.current) return
    const typed = factor === 'code' ? normalizeTotpCode(values.code) : normalizeRecoveryCode(values.recoveryCode)
    if (!typed) {
      // A code that cannot be right is never sent: it would cost one of the five attempts.
      form.setFields([
        { name: factor, errors: [t(factor === 'code' ? 'login.mfa.codeFormat' : 'login.mfa.recoveryCodeFormat')] },
      ])
      setFocusRequest((count) => count + 1)
      return
    }

    busy.current = true
    setSubmitting(true)
    setFailure(null)
    try {
      const user = await completeMfaLogin(challenge.challenge, factor === 'code' ? { code: typed } : { recoveryCode: typed })
      onSuccess(user)
    } catch (error) {
      const described = describeMfaSignInFailure(error, factor)
      if (described.kind === 'restart') {
        onRestart('ended')
        return
      }
      if (described.kind === 'locked') {
        // Until the lock ends the server answers every code with it, and a lock usually outlives the
        // challenge: a live form beside "locked for 15 minutes" would only invite codes that cannot work.
        onRestart('locked', { minutes: described.minutes })
        return
      }
      if (described.spendsAttempt) {
        wrongCodes.current += 1
        if (challengeExhausted(wrongCodes.current)) {
          // The server consumed the challenge with this wrong code: asking for another one
          // could only end in `mfa_challenge_invalid`.
          onRestart('ended')
          return
        }
      }
      if (described.kind === 'field') {
        form.setFields([{ name: factor, value: '', errors: [t(described.key)] }])
      } else {
        if (!described.keepsInput) form.setFields([{ name: factor, value: '', errors: [] }])
        setFailure(described)
      }
      setFocusRequest((count) => count + 1)
    } finally {
      busy.current = false
      setSubmitting(false)
    }
  }

  const switchFactor = () => {
    // The code typed for the other factor is dropped with its field.
    form.resetFields()
    setFailure(null)
    setFactor((current) => (current === 'code' ? 'recoveryCode' : 'code'))
  }

  if (expired) {
    return (
      <>
        <Alert type="warning" showIcon title={<span id={expiredMessageId}>{t('login.mfa.expired')}</span>} />
        <Flex justify="center" style={{ marginTop: 16 }}>
          <Button ref={signInAgainRef} type="primary" aria-describedby={expiredMessageId} onClick={() => onRestart('back')}>
            {t('login.mfa.signInAgain')}
          </Button>
        </Flex>
      </>
    )
  }

  const line = expiryLine(minutesLeft)

  return (
    <>
      <Typography.Paragraph>{t(factor === 'code' ? 'login.mfa.intro' : 'login.mfa.recoveryIntro')}</Typography.Paragraph>

      {failure ? (
        <Alert
          type="error"
          showIcon
          title={t(failure.key, { minutes: failure.minutes ?? '' })}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Form<StepValues>
        form={form}
        name="mfa-step"
        layout="vertical"
        requiredMark={false}
        onFinish={submit}
        disabled={submitting}
      >
        {factor === 'code' ? (
          <Form.Item
            key="code"
            name="code"
            label={t('login.mfa.code')}
            rules={[{ required: true, whitespace: true, message: t('login.mfa.codeRequired') }]}
          >
            <Input
              ref={inputRef}
              className="mfa-code-input"
              size="large"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={TOTP_INPUT_MAX_LENGTH}
            />
          </Form.Item>
        ) : (
          <Form.Item
            key="recoveryCode"
            name="recoveryCode"
            label={t('login.mfa.recoveryCode')}
            rules={[{ required: true, whitespace: true, message: t('login.mfa.recoveryCodeRequired') }]}
          >
            <Input
              ref={inputRef}
              className="mfa-code-input mfa-code-input--recovery"
              size="large"
              dir="ltr"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder={RECOVERY_CODE_PLACEHOLDER}
              maxLength={RECOVERY_INPUT_MAX_LENGTH}
            />
          </Form.Item>
        )}

        <Button type="primary" htmlType="submit" block loading={submitting}>
          {submitting ? t('login.mfa.submitting') : t('login.mfa.submit')}
        </Button>
      </Form>

      {line ? (
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center', margin: '12px 0 0' }}>
          {t(line.key, { minutes: line.minutes })}
        </Typography.Paragraph>
      ) : null}

      <Flex justify="space-between" wrap gap={8} style={{ marginTop: 8 }}>
        <Button type="link" onClick={switchFactor} disabled={submitting} style={{ paddingInline: 0 }}>
          {t(factor === 'code' ? 'login.mfa.useRecoveryCode' : 'login.mfa.useAuthenticatorCode')}
        </Button>
        <Button type="link" onClick={() => onRestart('back')} disabled={submitting} style={{ paddingInline: 0 }}>
          {t('login.mfa.backToSignIn')}
        </Button>
      </Flex>
    </>
  )
}
