// /register/complete/:token (PORTAL-04 on the contract v2 of GitHub #207): the e-mailed link. Shows the masked address and
// the name, and the visitor chooses a password. It opens NO session: success goes to the sign-in page, replacing this
// history entry so the token leaves it. The token exists only in the URL and in the two requests of its own route.
import { UserOutlined } from '@ant-design/icons'
import { Alert, Button, Descriptions, Flex, Form, Input, Spin, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { isTokenShaped } from '../account/account.links'
import { NewPasswordForm } from '../account/NewPasswordForm'
import { DeadLinkNotice, PublicCard } from '../account/PublicCard'
import { completeRegistration, getRegistrationLink } from '../api/registration'
import type { RegistrationPreview } from '../api/registration'
import { signInNoticeState } from '../auth/mfa.signIn'
import { enrollIntentPath } from '../publicCatalog/publicCatalog.view'
import { PublicOnly } from '../publicCatalog/PublicShell'
import { readKeptCourse, takeKeptCourse } from '../studentRegistration/keptCourse'
import { RegistrationClosedNotice } from '../studentRegistration/RegistrationClosedNotice'
import { describeCompleteFailure, describeLinkFailure } from '../studentRegistration/registration.errors'
import type { RegistrationMessage } from '../studentRegistration/registration.errors'
import { changedFullName, fullNameProblem } from '../studentRegistration/registration.rules'

type DeadLink = 'link_invalid' | 'link_expired' | 'closed'

export function StudentRegisterCompletePage() {
  return (
    <PublicOnly signedInTo="/my-classes">
      <CompleteBody />
    </PublicOnly>
  )
}

function CompleteBody() {
  const { token } = useParams<{ token: string }>()
  const { t } = useTranslation()
  const [preview, setPreview] = useState<RegistrationPreview | null>(null)
  const [verdict, setVerdict] = useState<DeadLink | null>(null)
  const [readFailure, setReadFailure] = useState<RegistrationMessage | null>(null)
  const [attempt, setAttempt] = useState(0)

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
  } else if (dead === 'link_expired') {
    body = <ExpiredLinkNotice />
  } else if (dead === 'link_invalid') {
    body = <DeadLinkNotice message={t('studentRegistration.complete.linkInvalid')} />
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
    body = <CompleteForm token={token} preview={preview} onDead={setVerdict} />
  }

  return <PublicCard subtitle={t('studentRegistration.complete.subtitle')}>{body}</PublicCard>
}

/** A link that ran out: the visitor registers again, and a course still kept on this device goes along. */
function ExpiredLinkNotice() {
  const { t } = useTranslation()
  const [course] = useState(() => readKeptCourse())
  const state = course ? { from: enrollIntentPath(course) } : undefined
  return (
    <>
      <Alert type="warning" showIcon title={t('studentRegistration.complete.linkExpired')} />
      <Flex vertical align="center" gap={8} style={{ marginTop: 16 }}>
        <Link to="/register" state={state}>
          {t('studentRegistration.complete.registerAgain')}
        </Link>
        <Link to="/login" state={state}>
          {t('account.goToLogin')}
        </Link>
      </Flex>
    </>
  )
}

function CompleteForm({
  token,
  preview,
  onDead,
}: {
  token: string
  preview: RegistrationPreview
  onDead: (verdict: DeadLink) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // A second press lands before React has re-rendered the loading button: one request per press.
  const busy = useRef(false)

  const onSubmit = async (password: string, extra: Record<string, unknown>) => {
    if (busy.current) return
    busy.current = true
    setSubmitting(true)
    setFormError(null)
    const fullName = changedFullName(preview.fullName, extra.fullName)
    try {
      await completeRegistration(token, fullName === undefined ? { password } : { password, fullName })
    } catch (error) {
      busy.current = false
      setSubmitting(false)
      const failure = describeCompleteFailure(error)
      if (failure.kind === 'fields') {
        form.setFields(
          failure.fields.map(({ name, messages }) => ({
            name,
            errors: messages.map((item) => t(item.key, { ...item.params })),
          })),
        )
      } else if (failure.kind === 'message') {
        setFormError(t(failure.key, { ...failure.params }))
      } else {
        onDead(failure.kind)
      }
      return
    }
    // The account is active and no session was opened. `replace` drops the history entry that carries the token; only
    // a known notice id and a checked path of this site travel to the sign-in page.
    const course = takeKeptCourse()
    navigate('/login', {
      replace: true,
      state: { ...signInNoticeState('registration_completed'), ...(course ? { from: enrollIntentPath(course) } : {}) },
    })
  }

  return (
    <>
      <Typography.Paragraph>{t('studentRegistration.complete.intro')}</Typography.Paragraph>
      <Descriptions
        column={1}
        size="small"
        style={{ marginBottom: 16 }}
        items={[
          {
            key: 'email',
            label: t('studentRegistration.complete.email'),
            children: <bdi dir="ltr">{preview.maskedEmail}</bdi>,
          },
        ]}
      />
      <NewPasswordForm
        form={form}
        initialValues={{ fullName: preview.fullName }}
        extraFields={
          <Form.Item
            name="fullName"
            label={t('studentRegistration.complete.fullName')}
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
            <Input prefix={<UserOutlined />} autoComplete="name" dir="auto" />
          </Form.Item>
        }
        submitLabel={t('studentRegistration.complete.submit')}
        submittingLabel={t('studentRegistration.complete.submitting')}
        submitting={submitting}
        error={formError}
        onSubmit={onSubmit}
      />
    </>
  )
}
