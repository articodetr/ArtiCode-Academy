// The public verification page (J-F51 — D-R56): /verify and /verify/:code,
// outside the app layout and without a sign-in, like the token pages of
// MOD-03-T12. It reads API-134 (`@Public()`, 60 requests per minute per IP —
// SEC-R-19) without an access token and without a session refresh
// (api/certificates.ts), and shows what the server returns from the snapshot
// only: valid or revoked (with the day of the revocation), the serial, the
// student's names, the course, the grade, the day of issue and the academy —
// never a reason or an internal id, which the server does not send. A code
// that cannot be one (normalizeVerificationCode — the server's own rule) is
// «not found» at once, without a request, as the server would answer it; a
// 429 asks the visitor to wait a minute and try again. The form checks another
// code; the code travels in the URL only and is never stored.
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { Alert, Button, Descriptions, Flex, Form, Input, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { PublicCard } from '../account/PublicCard'
import { verifyCertificate } from '../api/certificates'
import type { CertificateVerification } from '../api/certificates'
import { describeVerificationFailure } from '../certificates/certificates.errors'
import { bandOf, formatCertificateDay, formatPercent } from '../certificates/certificates.format'
import { normalizeVerificationCode, verificationPath } from '../certificates/certificates.links'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'

interface VerificationState {
  /** The request the state answers (the code and the attempt). */
  key: string
  result: CertificateVerification | null
  error: unknown
}

export function VerifyCertificatePage() {
  const { code: param } = useParams<{ code?: string }>()
  const { t } = useTranslation()
  const code = normalizeVerificationCode(param)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<VerificationState>({ key: '', result: null, error: null })
  const requestKey = `${code ?? ''}:${attempt}`
  const loading = code !== null && state.key !== requestKey

  useEffect(() => {
    if (!code) return
    const controller = new AbortController()
    verifyCertificate(code, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setState({ key: requestKey, result, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key: requestKey, result: null, error })
      })
    return () => controller.abort()
  }, [code, requestKey])

  let body = null
  if (param !== undefined && code === null) {
    // The server would answer the same 404 without looking (D-R56).
    body = <Alert type="warning" showIcon title={t('certificates.verify.notFound')} />
  } else if (loading) {
    body = (
      <Flex justify="center" style={{ padding: 24 }}>
        <Spin size="large" />
      </Flex>
    )
  } else if (code && state.error) {
    const failure = describeVerificationFailure(state.error)
    body = failure.terminal ? (
      <Alert type="warning" showIcon title={t(failure.key)} />
    ) : (
      <Alert
        type="error"
        showIcon
        title={t('certificates.verify.failed')}
        description={t(failure.key)}
        action={
          <Button size="small" onClick={() => setAttempt((count) => count + 1)}>
            {t('certificates.verify.retry')}
          </Button>
        }
      />
    )
  } else if (code && state.result) {
    body = <VerificationResult result={state.result} />
  }

  return (
    <PublicCard subtitle={t('certificates.verify.subtitle')}>
      {body ? <div style={{ marginBottom: 16 }}>{body}</div> : <Typography.Paragraph>{t('certificates.verify.intro')}</Typography.Paragraph>}
      {/* Keyed by the code on screen, so the field starts empty after every check. */}
      <CodeForm key={param ?? ''} again={body !== null} />
    </PublicCard>
  )
}

function VerificationResult({ result }: { result: CertificateVerification }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const revoked = result.status === 'revoked'
  return (
    <>
      <Alert
        type={revoked ? 'error' : 'success'}
        showIcon
        icon={revoked ? <CloseCircleOutlined /> : <CheckCircleOutlined />}
        title={t(revoked ? 'certificates.verify.revoked' : 'certificates.verify.valid')}
        description={revoked ? t('certificates.verify.revokedOn', { date: formatCertificateDay(result.revokedAt, language) }) : t('certificates.verify.validHint')}
        style={{ marginBottom: 16 }}
      />
      <Descriptions
        column={1}
        size="small"
        bordered
        items={[
          {
            key: 'serial',
            label: t('certificates.verify.fields.serial'),
            children: (
              <Typography.Text strong dir="ltr">
                {result.serial}
              </Typography.Text>
            ),
          },
          {
            key: 'student',
            label: t('certificates.verify.fields.student'),
            children: (
              <span>
                <span>{result.student.fullName}</span>
                {result.student.fullNameLatin ? (
                  <>
                    <br />
                    <Typography.Text type="secondary" dir="ltr">
                      {result.student.fullNameLatin}
                    </Typography.Text>
                  </>
                ) : null}
              </span>
            ),
          },
          {
            key: 'course',
            label: t('certificates.verify.fields.course'),
            children: (
              <span>
                {localizedLabel(result.course.name, language)} (<bdi dir="ltr">{result.course.code}</bdi>)
              </span>
            ),
          },
          {
            key: 'grade',
            label: t('certificates.verify.fields.grade'),
            children: (
              <span>
                <bdi dir="ltr">{formatPercent(result.grade.percent)}</bdi> — {bandOf(result.grade, language)}
              </span>
            ),
          },
          { key: 'issuedAt', label: t('certificates.verify.fields.issuedAt'), children: formatCertificateDay(result.issuedAt, language) },
          { key: 'academy', label: t('certificates.verify.fields.academy'), children: localizedLabel(result.academy.name, language) || '—' },
        ]}
      />
    </>
  )
}

/** Checks a typed code: a malformed one is refused on the field (no request); a good one opens its page. */
function CodeForm({ again }: { again: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)

  const submit = () => {
    const code = normalizeVerificationCode(value)
    if (!code) {
      setInvalid(true)
      return
    }
    navigate(verificationPath(code))
  }

  return (
    <Form layout="vertical" onFinish={submit} requiredMark={false}>
      <Form.Item
        label={t(again ? 'certificates.verify.checkAnother' : 'certificates.verify.code')}
        htmlFor="certificate-verification-code"
        validateStatus={invalid ? 'error' : undefined}
        help={invalid ? t('certificates.verify.invalidCode') : t('certificates.verify.codeHint')}
      >
        <Input
          id="certificate-verification-code"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setInvalid(false)
          }}
        />
      </Form.Item>
      <Button type="primary" htmlType="submit" block>
        {t('certificates.verify.submit')}
      </Button>
    </Form>
  )
}
