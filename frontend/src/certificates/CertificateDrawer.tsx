// Detail drawer of one certificate (J-F51): reads GET /api/certificates/:id
// (API-131 — `certificates.read_all` or `certificates.issue`, D-R57) and shows
// what the certificate says — the student, course, class and academy of the
// snapshot taken at issuance (D-R50), with the current name beside a printed
// one that changed since — its grade, serial, verification code and link, and
// its lifecycle: issued when and by whom and, once revoked, when, by whom and
// why (the reason is shown here only: «my certificates» and the public
// verification never carry it). A print button opens the print page in a new
// tab; holders of `certificates.revoke` revoke an issued certificate with a
// required reason (RevokeCertificateModal → API-133), and the drawer and the
// list row then show the server's answer. The lifecycle instants use
// formatDateTime like every drawer.
import { PrinterOutlined, StopOutlined } from '@ant-design/icons'
import { Alert, Button, Descriptions, Drawer, Skeleton, Space, Typography } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { getCertificate } from '../api/certificates'
import type { Certificate } from '../api/certificates'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime, localizedLabel } from '../users/users.format'
import { CertificateStatusTag } from './CertificateStatusTag'
import { RevokeCertificateModal } from './RevokeCertificateModal'
import { describeCertificatesFailure, failureMessage, isCertificatesFailure } from './certificates.errors'
import { differentName, gradeLine } from './certificates.format'
import { certificatePrintPath, groupVerificationCode, verificationUrl } from './certificates.links'
import { canRevokeCertificates } from './certificates.policy'

interface CertificateDrawerProps {
  certificateId: string | null
  onClose: () => void
  /** The certificate the server returned after a re-read or a revocation. */
  onUpdated: (certificate: Certificate) => void
}

/** A printed name, with the current one beneath it when it changed since the issuance. */
function NamedValue({ printed, current, code }: { printed: string; current: string | null; code?: string }) {
  const { t } = useTranslation()
  return (
    <span>
      <span>{printed}</span>
      {code ? (
        <>
          {' '}
          (<bdi dir="ltr">{code}</bdi>)
        </>
      ) : null}
      {current ? (
        <>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('certificates.drawer.currentName', { name: current })}
          </Typography.Text>
        </>
      ) : null}
    </span>
  )
}

export function CertificateDrawer({ certificateId, onClose, onUpdated }: CertificateDrawerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const canRevoke = canRevokeCertificates(hasPermission)
  const [certificate, setCertificate] = useState<Certificate | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [revoking, setRevoking] = useState(false)

  // The read below hands every re-read to the list; a ref, so a new `onUpdated` never restarts the read.
  const onUpdatedRef = useRef(onUpdated)
  useEffect(() => {
    onUpdatedRef.current = onUpdated
  }, [onUpdated])

  useEffect(() => {
    if (!certificateId) return
    const controller = new AbortController()
    getCertificate(certificateId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setCertificate(loaded)
        setLoadError(null)
        // A re-read (after a stale revocation, or the retry) refreshes the list row too.
        if (reloadTick > 0) onUpdatedRef.current(loaded)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const failure = describeCertificatesFailure(error)
        if (isCertificatesFailure(failure, 'certificate_not_found')) setCertificate(null)
        setLoadError(failureMessage(t, failure))
      })
    return () => controller.abort()
  }, [certificateId, reloadTick, t])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  const close = () => {
    setCertificate(null)
    setLoadError(null)
    setRevoking(false)
    setReloadTick(0)
    onClose()
  }

  const shown = certificate && certificate.id === certificateId ? certificate : null
  const snapshot = shown?.snapshot
  const items: Array<{ key: string; label: string; children: ReactNode }> =
    shown && snapshot
      ? [
          {
            key: 'serial',
            label: t('certificates.drawer.serial'),
            children: (
              <Typography.Text strong copyable dir="ltr">
                {shown.serial}
              </Typography.Text>
            ),
          },
          { key: 'status', label: t('common.status'), children: <CertificateStatusTag status={shown.status} /> },
          {
            key: 'student',
            label: t('common.student'),
            children: (
              <span>
                <NamedValue printed={snapshot.student.fullName} current={differentName(shown.student.fullName, snapshot.student.fullName, language)} />
                {snapshot.student.fullNameLatin ? (
                  <>
                    <br />
                    <Typography.Text type="secondary" dir="ltr">
                      {snapshot.student.fullNameLatin}
                    </Typography.Text>
                  </>
                ) : null}
              </span>
            ),
          },
          {
            key: 'course',
            label: t('common.course'),
            children: (
              <NamedValue
                printed={localizedLabel(snapshot.course.name, language)}
                code={snapshot.course.code}
                current={differentName(shown.course.name, snapshot.course.name, language)}
              />
            ),
          },
          {
            key: 'class',
            label: t('certificates.columns.class'),
            children: (
              <NamedValue printed={localizedLabel(snapshot.class.name, language)} code={snapshot.class.code} current={differentName(shown.class.name, snapshot.class.name, language)} />
            ),
          },
          { key: 'grade', label: t('certificates.columns.grade'), children: <bdi>{gradeLine(shown.grade, language)}</bdi> },
          { key: 'academy', label: t('certificates.drawer.academy'), children: localizedLabel(snapshot.academy.name, language) || '—' },
          { key: 'completedAt', label: t('certificates.drawer.completedAt'), children: formatDateTime(snapshot.completedAt, language) },
          {
            key: 'issued',
            label: t('certificates.drawer.issuedAt'),
            children: (
              <span>
                {formatDateTime(shown.issuedAt, language)}
                {shown.issuedBy ? (
                  <>
                    <br />
                    <Typography.Text type="secondary">{t('certificates.drawer.by', { name: shown.issuedBy.fullName })}</Typography.Text>
                  </>
                ) : null}
              </span>
            ),
          },
          {
            key: 'verification',
            label: t('certificates.drawer.verificationCode'),
            children: (
              <span>
                <Typography.Text code dir="ltr">
                  {groupVerificationCode(shown.verificationCode)}
                </Typography.Text>
                <br />
                <Typography.Text
                  type="secondary"
                  dir="ltr"
                  style={{ fontSize: 12, wordBreak: 'break-all' }}
                  copyable={{ text: verificationUrl(shown.verificationCode, window.location.origin), tooltips: [t('certificates.drawer.copyLink'), t('certificates.drawer.copied')] }}
                >
                  {verificationUrl(shown.verificationCode, window.location.origin)}
                </Typography.Text>
              </span>
            ),
          },
          ...(shown.status === 'revoked'
            ? [
                {
                  key: 'revoked',
                  label: t('certificates.drawer.revokedAt'),
                  children: (
                    <span>
                      {formatDateTime(shown.revokedAt, language)}
                      {shown.revokedBy ? (
                        <>
                          <br />
                          <Typography.Text type="secondary">{t('certificates.drawer.by', { name: shown.revokedBy.fullName })}</Typography.Text>
                        </>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: 'reason',
                  label: t('certificates.drawer.revokeReason'),
                  children: <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{shown.revokeReason ?? '—'}</Typography.Paragraph>,
                },
              ]
            : []),
        ]
      : []

  return (
    <Drawer
      open={certificateId !== null}
      onClose={close}
      // The revocation dialog sits on top: Escape and a click outside belong to it while it is open.
      keyboard={!revoking}
      mask={{ closable: !revoking }}
      title={shown ? <bdi dir="ltr">{shown.serial}</bdi> : t('certificates.drawer.title')}
      size="large"
      destroyOnHidden
      extra={
        shown ? (
          <Space>
            <Button icon={<PrinterOutlined />} href={certificatePrintPath(shown.id)} target="_blank" rel="noopener noreferrer">
              {t('certificates.drawer.print')}
            </Button>
            {canRevoke && shown.status === 'issued' ? (
              <Button danger icon={<StopOutlined />} onClick={() => setRevoking(true)}>
                {t('certificates.drawer.revoke')}
              </Button>
            ) : null}
          </Space>
        ) : null
      }
    >
      {loadError ? (
        <Alert
          type="error"
          showIcon
          title={loadError}
          action={
            <Button size="small" onClick={reload}>
              {t('certificates.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {!shown && !loadError ? <Skeleton active paragraph={{ rows: 8 }} data-testid="certificate-loading" /> : null}

      {shown ? (
        <>
          {shown.status === 'revoked' ? (
            <Alert type="error" showIcon title={t('certificates.drawer.revokedNotice', { date: formatDateTime(shown.revokedAt, language) })} style={{ marginBottom: 16 }} />
          ) : null}
          <Descriptions column={1} bordered size="small" items={items} />
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
            {t('certificates.drawer.snapshotHint')}
          </Typography.Paragraph>
        </>
      ) : null}

      {shown && revoking ? (
        <RevokeCertificateModal
          // Mounted per revocation, so a reason never carries over.
          certificate={shown}
          onDone={(revoked) => {
            setRevoking(false)
            setCertificate(revoked)
            onUpdated(revoked)
          }}
          onStale={() => {
            setRevoking(false)
            reload()
          }}
          onCancel={() => setRevoking(false)}
        />
      ) : null}
    </Drawer>
  )
}
