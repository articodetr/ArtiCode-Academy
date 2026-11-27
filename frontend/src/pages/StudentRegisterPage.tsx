// /register (PORTAL-04 — the owner's request of 2026-11-26): a visitor creates a student account with exactly four fields
// — الاسم الكامل، البريد الإلكتروني، كلمة المرور، تأكيد كلمة المرور — and «إنشاء حساب», in the frame of the account
// pages (auth/AuthLayout.tsx). The server creates the account active and signs it in at once (201 with the session —
// api/registration.ts): no e-mail to confirm, no extra field, no terms box. The session is adopted (as on the invitation
// page), a short message says the account was created, and the page goes on — replacing this history entry — where a
// sign-in goes (signInTarget() of auth/returnPath.ts): the return path the page was opened with (`?returnTo=` or the
// router state's `from`, a path of this site only — a visitor who came from a course goes back to
// `/catalog/<id>?intent=enroll`, where a free course enrolls and a paid one sends a request, MOD-19), else the home page.
// A course kept on this device by an earlier visit (keptCourse.ts) is cleared, never followed.
// The page is closed unless API-205 says `selfRegistration: true`; a failed read closes it. PORTAL-04-GOOGLE-OFF
// (provisional id — the owner's request): no «المتابعة باستخدام Google» and no «أو» any more. Under the form,
// «لديك حساب بالفعل؟ تسجيل الدخول» leads to /login with the same `returnTo`. The password lives in the form only: it is
// sent once, never trimmed, never stored.
import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, App, Button, Flex, Form, Input, Spin, Typography } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation } from 'react-router'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../account/account.links'
import { usePublicAcademy } from '../academy/usePublicAcademy'
import { isSelfRegistrationOpen } from '../api/academy'
import { register } from '../api/registration'
import { useAuth } from '../auth/auth-context'
import { AuthLayout, AuthPrompt } from '../auth/AuthLayout'
import { requestedReturnPath, signInTarget, withReturnTo } from '../auth/returnPath'
import type { SignInDestination } from '../auth/returnPath'
import { useLocalized } from '../i18n/useLocalized'
import { PublicOnly } from '../publicCatalog/PublicShell'
import { clearKeptCourse } from '../studentRegistration/keptCourse'
import { RegistrationClosedNotice } from '../studentRegistration/RegistrationClosedNotice'
import { describeRegisterFailure } from '../studentRegistration/registration.errors'
import type { RegistrationMessage } from '../studentRegistration/registration.errors'
import {
  confirmationProblem,
  emailProblem,
  fullNameProblem,
  passwordProblem,
} from '../studentRegistration/registration.rules'

interface RegisterValues {
  fullName: string
  email: string
  password: string
  confirmPassword: string
}

export function StudentRegisterPage() {
  // Where the new session goes. It is set in the same update that adopts the session and rendered here, above
  // PublicOnly, so that wrapper's own redirect of a signed-in learner (to /my-classes) never races this one.
  const [arrival, setArrival] = useState<SignInDestination | null>(null)
  if (arrival) return <Navigate to={arrival.path} state={arrival.state} replace />
  return (
    <PublicOnly signedInTo="/my-classes">
      <RegisterBody onRegistered={setArrival} />
    </PublicOnly>
  )
}

function RegisterBody({ onRegistered }: { onRegistered: (destination: SignInDestination) => void }) {
  const { t } = useTranslation()
  const location = useLocation()
  // A path of this site only (returnPath.ts): `?returnTo=` (or the router state's `from`) is where the new account goes,
  // and goes on to the sign-in page unchanged.
  const from = requestedReturnPath(location.search, location.state)
  const reading = usePublicAcademy()
  const [closedByServer, setClosedByServer] = useState(false)

  const emailOpen = !closedByServer && isSelfRegistrationOpen(reading.academy)

  let body
  if (reading.loading) {
    body = (
      <Flex justify="center" style={{ padding: 24 }}>
        <Spin size="large" />
      </Flex>
    )
  } else if (!emailOpen) {
    body = <RegistrationClosedNotice from={from} />
  } else {
    body = (
      <>
        <Typography.Paragraph type="secondary">{t('studentRegistration.register.intro')}</Typography.Paragraph>
        <RegisterForm from={from} onRegistered={onRegistered} onClosed={() => setClosedByServer(true)} />
        {/* «لديك حساب بالفعل؟ تسجيل الدخول» under the form, with the same return path. The closed
            notice carries its own way to the sign-in page. */}
        <AuthPrompt question={t('studentRegistration.register.haveAccount')} testId="register-sign-in">
          <Link to={withReturnTo('/login', from)}>{t('studentRegistration.register.signIn')}</Link>
        </AuthPrompt>
      </>
    )
  }

  return (
    <AuthLayout title={t('studentRegistration.register.title')} academy={reading}>
      {body}
    </AuthLayout>
  )
}

function RegisterForm({
  from,
  onRegistered,
  onClosed,
}: {
  from: string | null
  onRegistered: (destination: SignInDestination) => void
  onClosed: () => void
}) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { adoptSession } = useAuth()
  const { message: toast } = App.useApp()
  const [form] = Form.useForm<RegisterValues>()
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<RegistrationMessage | null>(null)
  // A second press lands before React has re-rendered the loading button: one request per press.
  const busy = useRef(false)

  const onFinish = async (values: RegisterValues) => {
    if (busy.current) return
    busy.current = true
    setSubmitting(true)
    setMessage(null)
    let session
    try {
      // Exactly the contract's fields: the confirmation stays here. The password goes exactly as typed.
      session = await register({
        fullName: values.fullName.trim(),
        email: values.email.trim(),
        password: values.password,
        locale: language,
      })
    } catch (error) {
      busy.current = false
      setSubmitting(false)
      const failure = describeRegisterFailure(error)
      if (failure.kind === 'closed') {
        onClosed()
      } else if (failure.kind === 'fields') {
        form.setFields(
          failure.fields.map(({ name, messages }) => ({
            name: name as keyof RegisterValues,
            errors: messages.map((item) => t(item.key, { ...item.params })),
          })),
        )
        const first = failure.fields[0]
        if (first) form.focusField(first.name as keyof RegisterValues)
      } else if (failure.kind === 'message') {
        setMessage({ key: failure.key, params: failure.params })
      }
      return
    }
    // The account exists and is signed in (the access token is stored by register(), the refresh cookie by the server).
    // Only this visit's return path leads on: a course kept on this device by an earlier visit — perhaps another
    // person's, on a shared device — is never followed, and is cleared so no later sign-in offers it either.
    const user = adoptSession(session)
    clearKeptCourse()
    const target = signInTarget(user, from, null)
    toast.success(t('studentRegistration.register.created'))
    onRegistered({ path: target.path, state: target.state })
  }

  return (
    <Form<RegisterValues> form={form} layout="vertical" requiredMark={false} onFinish={onFinish}>
      {message ? <Alert type="error" showIcon title={t(message.key, { ...message.params })} style={{ marginBottom: 16 }} /> : null}

      <Form.Item
        name="fullName"
        label={t('studentRegistration.register.fullName')}
        rules={[
          {
            validator: (_, value: unknown) => {
              const problem = fullNameProblem(value)
              return problem
                ? Promise.reject(new Error(t(`studentRegistration.validation.fullName.${problem}`)))
                : Promise.resolve()
            },
          },
        ]}
      >
        <Input prefix={<UserOutlined />} autoComplete="name" dir="auto" autoFocus readOnly={submitting} />
      </Form.Item>

      <Form.Item
        name="email"
        label={t('studentRegistration.register.email')}
        rules={[
          {
            validator: (_, value: unknown) => {
              const problem = emailProblem(value)
              return problem
                ? Promise.reject(new Error(t(`studentRegistration.validation.email.${problem}`)))
                : Promise.resolve()
            },
          },
        ]}
      >
        <Input
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          prefix={<MailOutlined />}
          autoComplete="email"
          dir="ltr"
          readOnly={submitting}
        />
      </Form.Item>

      <Form.Item
        name="password"
        label={t('studentRegistration.register.password')}
        extra={t('studentRegistration.register.passwordHint', { min: PASSWORD_MIN_LENGTH })}
        rules={[
          {
            validator: (_, value: unknown) => {
              const problem = passwordProblem(value)
              if (problem === null) return Promise.resolve()
              return Promise.reject(
                new Error(
                  problem === 'required'
                    ? t('studentRegistration.register.passwordRequired')
                    : t('account.validation.passwordPolicy', { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH }),
                ),
              )
            },
          },
        ]}
      >
        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" readOnly={submitting} />
      </Form.Item>

      <Form.Item
        name="confirmPassword"
        label={t('studentRegistration.register.confirmPassword')}
        dependencies={['password']}
        rules={[
          ({ getFieldValue }) => ({
            validator: (_, value: unknown) => {
              const problem = confirmationProblem(getFieldValue('password'), value)
              if (problem === null) return Promise.resolve()
              return Promise.reject(
                new Error(
                  problem === 'required'
                    ? t('studentRegistration.register.confirmRequired')
                    : t('studentRegistration.register.mismatch'),
                ),
              )
            },
          }),
        ]}
      >
        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" readOnly={submitting} />
      </Form.Item>

      <Button type="primary" htmlType="submit" block loading={submitting}>
        {submitting ? t('studentRegistration.register.submitting') : t('studentRegistration.register.submit')}
      </Button>
    </Form>
  )
}
