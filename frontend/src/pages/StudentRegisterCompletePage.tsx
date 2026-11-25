// /register/complete/:token (PORTAL-04, contract v3): the e-mailed link, in the frame of the account pages
// (auth/AuthLayout.tsx). Shows the name and the masked address, and asks for the password chosen on /register: the link
// activates the account only with it, so whoever registered someone else's address cannot take the account over when its
// owner clicks the link. A wrong password says how many attempts are left; the last one retires the link, and the
// visitor registers again (as after a 404 or an expired link — «سجّل من جديد», carrying a course still kept on this
// device). Success opens the session the server returns (adopted as on the invitation page) and goes on — replacing this
// history entry so the token leaves it — where a sign-in goes (signInTarget(): a return path that names a page, else the
// course kept on this device for a student, else the home page). The token exists only in the URL and in the two
// requests of its own route; the password only in the form.
import { LockOutlined } from '@ant-design/icons'
import { Alert, Button, Descriptions, Flex, Form, Input, Spin, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useParams } from 'react-router'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, isAcceptablePassword, isTokenShaped } from '../account/account.links'
import { completeRegistration, getRegistrationLink } from '../api/registration'
import type { RegistrationPreview } from '../api/registration'
import { useAuth } from '../auth/auth-context'
import { AuthLayout } from '../auth/AuthLayout'
import { requestedReturnPath, signInTarget, withReturnTo } from '../auth/returnPath'
import type { SignInDestination } from '../auth/returnPath'
import { enrollIntentPath } from '../publicCatalog/publicCatalog.view'
import { PublicOnly } from '../publicCatalog/PublicShell'
import { readKeptCourse, takeKeptCourse } from '../studentRegistration/keptCourse'
import { RegistrationClosedNotice } from '../studentRegistration/RegistrationClosedNotice'
import { describeCompleteFailure, describeLinkFailure } from '../studentRegistration/registration.errors'
import type { RegistrationMessage } from '../studentRegistration/registration.errors'

type DeadLink = 'link_invalid' | 'link_expired' | 'link_exhausted' | 'closed'

const DEAD_LINK_MESSAGES: Record<Exclude<DeadLink, 'closed'>, string> = {
  link_invalid: 'studentRegistration.complete.linkInvalid',
  link_expired: 'studentRegistration.complete.linkExpired',
  link_exhausted: 'studentRegistration.complete.linkExhausted',
}

interface CompleteValues {
  password: string
}

export function StudentRegisterCompletePage() {
  // Where the new session goes. It is set in the same update that adopts the session and rendered here, above
  // PublicOnly, so that wrapper's own redirect of a signed-in learner never races this one.
  const [arrival, setArrival] = useState<SignInDestination | null>(null)
  if (arrival) return <Navigate to={arrival.path} state={arrival.state} replace />
  return (
    <PublicOnly signedInTo="/my-classes">
      <CompleteBody onActivated={setArrival} />
    </PublicOnly>
  )
}

function CompleteBody({ onActivated }: { onActivated: (destination: SignInDestination) => void }) {
  const { token } = useParams<{ token: string }>()
  const { t } = useTranslation()
  const [preview, setPreview] = useState<RegistrationPreview | null>(null)
  const [verdict, setVerdict] = useState<DeadLink | null>(null)
  const [readFailure, setReadFailure] = useState<RegistrationMessage | null>(null)
  const [attempt, setAttempt] = useState(0)
  // A course still kept on this device goes along to /register when the visitor registers again; read once.
  const [keptReturn] = useState(() => {
    const course = readKeptCourse()
    return course ? enrollIntentPath(course) : null
  })

  // A malformed token is dead before any request; a server verdict replaces it.
  const dead: DeadLink | null = verdict ?? (isTokenShaped(token) ? null : 'link_invalid')

  useEffect(() => {
    if (!isTokenShaped(token)) return
    const controller = new AbortController()
    getRegistrationLink(token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPreview(result)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const failure = describeLinkFailure(error)
        if (failure.kind === 'message') setReadFailure({ key: failure.key, params: failure.params })
        else if (failure.kind !== 'fields') setVerdict(failure.kind)
      })
    return () => controller.abort()
  }, [token, attempt])

  let body
  if (dead === 'closed') {
    body = <RegistrationClosedNotice />
  } else if (dead) {
    body = <RegisterAgainNotice message={t(DEAD_LINK_MESSAGES[dead])} returnTo={keptReturn} />
  } else if (readFailure) {
    body = (
      <>
        <Alert
          type="error"
          showIcon
          title={t('studentRegistration.complete.loadFailed')}
          description={t(readFailure.key, { ...readFailure.params })}
        />
        <Flex justify="center" style={{ marginTop: 16 }}>
          <Button
            onClick={() => {
              setReadFailure(null)
              setAttempt((count) => count + 1)
            }}
          >
            {t('studentRegistration.complete.retry')}
          </Button>
        </Flex>
      </>
    )
  } else if (!preview || !token) {
    body = (
      <Flex justify="center" style={{ padding: 24 }}>
        <Spin size="large" />
      </Flex>
    )
  } else {
    body = <CompleteForm token={token} preview={preview} keptReturn={keptReturn} onDead={setVerdict} onActivated={onActivated} />
  }

  return <AuthLayout title={t('studentRegistration.complete.title')}>{body}</AuthLayout>
}

/**
 * A link that can no longer activate the account: the reason, and the ways on — registering again (with a course still
 * kept on this device) or signing in. Both replace this history entry, so the token leaves it.
 */
function RegisterAgainNotice({ message, returnTo }: { message: string; returnTo: string | null }) {
  const { t } = useTranslation()
  return (
    <>
      <Alert type="warning" showIcon title={message} />
      <div className="auth-layout__links">
        <Link to={withReturnTo('/register', returnTo)} replace>
          {t('studentRegistration.complete.registerAgain')}
        </Link>
        <Link to={withReturnTo('/login', returnTo)} replace>
          {t('account.goToLogin')}
        </Link>
      </div>
    </>
  )
}

function CompleteForm({
  token,
  preview,
  keptReturn,
  onDead,
  onActivated,
}: {
  token: string
  preview: RegistrationPreview
  keptReturn: string | null
  onDead: (verdict: DeadLink) => void
  onActivated: (destination: SignInDestination) => void
}) {
  const { t } = useTranslation()
  const { adoptSession } = useAuth()
  const location = useLocation()
  const [form] = Form.useForm<CompleteValues>()
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // A second press lands before React has re-rendered the loading button: one request per press.
  const busy = useRef(false)

  const onFinish = async ({ password }: CompleteValues) => {
    if (busy.current) return
    busy.current = true
    setSubmitting(true)
    setFormError(null)
    let session
    try {
      session = await completeRegistration(token, { password })
    } catch (error) {
      busy.current = false
      setSubmitting(false)
      const failure = describeCompleteFailure(error)
      if (failure.kind === 'fields') {
        form.setFields(
          failure.fields.map(({ name, messages }) => ({
            name: name as keyof CompleteValues,
            errors: messages.map((item) => t(item.key, { ...item.params })),
          })),
        )
        form.focusField('password')
      } else if (failure.kind === 'message') {
        setFormError(t(failure.key, { ...failure.params }))
      } else {
        onDead(failure.kind)
      }
      return
    }
    // The account is active and signed in. The kept course is used up here whatever the destination: this device's
    // registration is over. Only a checked path of this site leads on (returnPath.ts).
    const user = adoptSession(session)
    const target = signInTarget(user, requestedReturnPath(location.search, location.state), takeKeptCourse())
    onActivated({ path: target.path, state: target.state })
  }

  return (
    <>
      <Typography.Paragraph type="secondary">{t('studentRegistration.complete.intro')}</Typography.Paragraph>
      <Descriptions
        column={1}
        size="small"
        style={{ marginBottom: 16 }}
        items={[
          { key: 'name', label: t('studentRegistration.complete.name'), children: <bdi>{preview.fullName}</bdi> },
          {
            key: 'email',
            label: t('studentRegistration.complete.email'),
            children: <bdi dir="ltr">{preview.maskedEmail}</bdi>,
          },
        ]}
      />
      <Form<CompleteValues> form={form} layout="vertical" requiredMark={false} onFinish={onFinish}>
        {formError ? <Alert type="error" showIcon title={formError} style={{ marginBottom: 16 }} /> : null}

        <Form.Item
          name="password"
          label={t('studentRegistration.complete.password')}
          extra={
            <>
              {t('studentRegistration.complete.forgotPassword')}{' '}
              <Link to={withReturnTo('/register', keptReturn)} replace>
                {t('studentRegistration.complete.registerWithNewPassword')}
              </Link>
            </>
          }
          rules={[
            {
              // A password that cannot be the chosen one (outside the policy it was checked against) is refused here:
              // every wrong one the server judges costs one of the link's attempts.
              validator: (_, value: unknown) => {
                if (typeof value !== 'string' || value.length === 0) {
                  return Promise.reject(new Error(t('studentRegistration.complete.passwordRequired')))
                }
                return isAcceptablePassword(value)
                  ? Promise.resolve()
                  : Promise.reject(
                      new Error(t('account.validation.passwordPolicy', { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })),
                    )
              },
            },
          ]}
        >
          <Input.Password prefix={<LockOutlined />} autoComplete="current-password" autoFocus readOnly={submitting} />
        </Form.Item>

        <Button type="primary" htmlType="submit" block loading={submitting}>
          {submitting ? t('studentRegistration.complete.submitting') : t('studentRegistration.complete.submit')}
        </Button>
      </Form>
    </>
  )
}
