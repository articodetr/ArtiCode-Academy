// /register (PORTAL-04 on the contract v2 of GitHub #207): a visitor asks for a student account with a name and an
// e-mail, in the frame of the account pages (auth/AuthLayout.tsx). The e-mail way is closed unless API-205 says
// `selfRegistration: true`; «المتابعة باستخدام Google» is enabled only while it says `googleSignUp: true` (Google proves
// the address, so it needs no mail and may stay open while the e-mail way is closed); a failed read closes both. The
// server answers 202 whatever the address, so the page shows one fixed message and never says whether an account
// exists. The password is chosen later, from the e-mailed link. The terms box is checked on this page only — the
// academy has no terms pages yet, so its words link nowhere — and nothing about it is sent. A course chosen before
// coming here waits on this device (keptCourse.ts); nothing enrolls.
import { MailOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Checkbox, Divider, Flex, Form, Input, Spin, Typography } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import { usePublicAcademy } from '../academy/usePublicAcademy'
import { isGoogleSignUpOpen, isSelfRegistrationOpen } from '../api/academy'
import { requestRegistration } from '../api/registration'
import { AuthLayout, AuthPrompt } from '../auth/AuthLayout'
import { GoogleSignInButton } from '../auth/GoogleSignInButton'
import { requestedReturnPath, withReturnTo } from '../auth/returnPath'
import { useLocalized } from '../i18n/useLocalized'
import { PublicOnly } from '../publicCatalog/PublicShell'
import { rememberChosenCourse } from '../studentRegistration/keptCourse'
import { RegistrationClosedNotice } from '../studentRegistration/RegistrationClosedNotice'
import { describeRegisterFailure } from '../studentRegistration/registration.errors'
import type { RegistrationMessage } from '../studentRegistration/registration.errors'
import { emailProblem, fullNameProblem } from '../studentRegistration/registration.rules'

interface RegisterValues {
  fullName: string
  email: string
  acceptTerms?: boolean
}

export function StudentRegisterPage() {
  return (
    <PublicOnly signedInTo="/my-classes">
      <RegisterBody />
    </PublicOnly>
  )
}

function RegisterBody() {
  const { t } = useTranslation()
  const location = useLocation()
  // A path of this site only (returnPath.ts): `?returnTo=` (or the router state's `from`) goes on to the sign-in
  // page and to Google unchanged.
  const from = requestedReturnPath(location.search, location.state)
  const reading = usePublicAcademy()
  const [closedByServer, setClosedByServer] = useState(false)
  const [sent, setSent] = useState(false)
  // Each new form is its own instance (KI-049); «another address» keeps the name and asks for the address again.
  const [formSession, setFormSession] = useState(0)
  const [lastName, setLastName] = useState('')

  const emailOpen = !closedByServer && isSelfRegistrationOpen(reading.academy)
  const googleOpen = isGoogleSignUpOpen(reading.academy)
  const signInLink = withReturnTo('/login', from)

  let body
  if (reading.loading) {
    body = (
      <Flex justify="center" style={{ padding: 24 }}>
        <Spin size="large" />
      </Flex>
    )
  } else if (!emailOpen && !googleOpen) {
    body = <RegistrationClosedNotice from={from} />
  } else if (sent) {
    body = (
      <>
        <Alert type="info" showIcon title={t('studentRegistration.register.sentTitle')} description={t('studentRegistration.register.sentText')} />
        <div className="auth-layout__links">
          <Link to={signInLink}>{t('studentRegistration.register.goToSignIn')}</Link>
          <Button
            type="link"
            onClick={() => {
              setSent(false)
              setFormSession((session) => session + 1)
            }}
          >
            {t('studentRegistration.register.anotherAddress')}
          </Button>
        </div>
      </>
    )
  } else {
    body = (
      <>
        <GoogleSignInButton enabled={googleOpen} disabledHint={t('login.google.signUpNotEnabled')} returnTo={from} />
        <Divider plain className="auth-layout__divider">
          {t('login.or')}
        </Divider>
        {emailOpen ? (
          <>
            <Typography.Paragraph type="secondary">{t('studentRegistration.register.intro')}</Typography.Paragraph>
            <RegisterForm
              key={formSession}
              initialName={lastName}
              // «Another address» is the same visitor, who has accepted the terms already.
              initialAccepted={lastName !== ''}
              onSent={(fullName) => {
                rememberChosenCourse({ from })
                setLastName(fullName)
                setSent(true)
              }}
              onClosed={() => setClosedByServer(true)}
            />
          </>
        ) : (
          <Alert
            type="info"
            showIcon
            data-testid="register-email-closed"
            title={t('studentRegistration.register.emailClosedTitle')}
            description={t('studentRegistration.register.emailClosedText')}
          />
        )}
      </>
    )
  }

  // «لديك حساب بالفعل؟ تسجيل الدخول» heads every state that has a form or Google's button; the closed notice and the
  // message after the 202 carry their own way to the sign-in page.
  const showsPrompt = !reading.loading && (emailOpen || googleOpen) && !sent
  return (
    <AuthLayout title={t('studentRegistration.register.title')} academy={reading}>
      {showsPrompt ? (
        <AuthPrompt question={t('studentRegistration.register.haveAccount')} testId="register-sign-in" placement="top">
          <Link to={signInLink}>{t('studentRegistration.register.signIn')}</Link>
        </AuthPrompt>
      ) : null}
      {body}
    </AuthLayout>
  )
}

function RegisterForm({
  initialName,
  initialAccepted,
  onSent,
  onClosed,
}: {
  initialName: string
  initialAccepted: boolean
  onSent: (fullName: string) => void
  onClosed: () => void
}) {
  const { t } = useTranslation()
  const { language } = useLocalized()
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
    const fullName = values.fullName.trim()
    try {
      // The terms box is not part of the contract: the server refuses any other field.
      await requestRegistration({ fullName, email: values.email.trim(), locale: language })
      onSent(fullName)
    } catch (error) {
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
    } finally {
      busy.current = false
      setSubmitting(false)
    }
  }

  return (
    <Form<RegisterValues>
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={{ fullName: initialName, acceptTerms: initialAccepted }}
      onFinish={onFinish}
    >
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
        <Input prefix={<UserOutlined />} autoComplete="name" dir="auto" autoFocus={!initialName} readOnly={submitting} />
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
          autoFocus={Boolean(initialName)}
          readOnly={submitting}
        />
      </Form.Item>

      <Form.Item
        name="acceptTerms"
        valuePropName="checked"
        rules={[
          {
            validator: (_, value: unknown) =>
              value === true ? Promise.resolve() : Promise.reject(new Error(t('studentRegistration.register.termsRequired'))),
          },
        ]}
      >
        <Checkbox disabled={submitting}>{t('studentRegistration.register.terms')}</Checkbox>
      </Form.Item>

      <Button type="primary" htmlType="submit" block loading={submitting}>
        {submitting ? t('studentRegistration.register.submitting') : t('studentRegistration.register.submit')}
      </Button>
    </Form>
  )
}
