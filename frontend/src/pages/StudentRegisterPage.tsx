// /register (PORTAL-04 on the contract v2 of GitHub #207): a visitor asks for a student account with a name and an
// e-mail. Closed unless API-205 says `selfRegistration: true`; a failed read is closed too. The server answers 202 whatever
// the address, so the page shows one fixed message and never says whether an account exists. The password is chosen later,
// from the e-mailed link. A course chosen before coming here waits on this device (keptCourse.ts); nothing enrolls.
import { MailOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Flex, Form, Input, Spin, Typography } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import { PublicCard } from '../account/PublicCard'
import { usePublicAcademy } from '../academy/usePublicAcademy'
import { isSelfRegistrationOpen } from '../api/academy'
import { requestRegistration } from '../api/registration'
import { returnPathOf } from '../auth/returnPath'
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
  // A path of this site only (returnPath.ts): it goes on to the sign-in page unchanged.
  const from = returnPathOf(location.state)
  const reading = usePublicAcademy()
  const [closedByServer, setClosedByServer] = useState(false)
  const [sent, setSent] = useState(false)
  // Each new form is its own instance (KI-049); «another address» keeps the name and asks for the address again.
  const [formSession, setFormSession] = useState(0)
  const [lastName, setLastName] = useState('')

  let body
  if (reading.loading) {
    body = (
      <Flex justify="center" style={{ padding: 24 }}>
        <Spin size="large" />
      </Flex>
    )
  } else if (closedByServer || !isSelfRegistrationOpen(reading.academy)) {
    body = <RegistrationClosedNotice from={from} />
  } else if (sent) {
    body = (
      <>
        <Alert
          type="info"
          showIcon
          title={t('studentRegistration.register.sentTitle')}
          description={t('studentRegistration.register.sentText')}
        />
        <Flex vertical align="center" gap={8} style={{ marginTop: 16 }}>
          <Link to="/login" state={from ? { from } : undefined}>
            {t('studentRegistration.register.goToSignIn')}
          </Link>
          <Button
            type="link"
            onClick={() => {
              setSent(false)
              setFormSession((session) => session + 1)
            }}
          >
            {t('studentRegistration.register.anotherAddress')}
          </Button>
        </Flex>
      </>
    )
  } else {
    body = (
      <>
        <Typography.Paragraph type="secondary">{t('studentRegistration.register.intro')}</Typography.Paragraph>
        <RegisterForm
          key={formSession}
          initialName={lastName}
          onSent={(fullName) => {
            rememberChosenCourse(location.state)
            setLastName(fullName)
            setSent(true)
          }}
          onClosed={() => setClosedByServer(true)}
        />
        <Flex justify="center" style={{ marginTop: 16 }}>
          <Link to="/login" state={from ? { from } : undefined}>
            {t('studentRegistration.register.haveAccount')}
          </Link>
        </Flex>
      </>
    )
  }

  return <PublicCard subtitle={t('studentRegistration.register.subtitle')}>{body}</PublicCard>
}

function RegisterForm({
  initialName,
  onSent,
  onClosed,
}: {
  initialName: string
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
      initialValues={{ fullName: initialName }}
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
        <Input size="large" prefix={<UserOutlined />} autoComplete="name" dir="auto" autoFocus={!initialName} />
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
          size="large"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          prefix={<MailOutlined />}
          autoComplete="email"
          dir="ltr"
          autoFocus={Boolean(initialName)}
        />
      </Form.Item>

      <Button type="primary" size="large" htmlType="submit" block loading={submitting}>
        {submitting ? t('studentRegistration.register.submitting') : t('studentRegistration.register.submit')}
      </Button>
    </Form>
  )
}
