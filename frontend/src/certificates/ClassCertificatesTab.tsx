// The «certificates» tab of the class drawer (J-F51 — MOD-10-T06): the
// preview of the class (GET /api/classes/:id/certificates — API-136, for
// `certificates.read_all` or `certificates.issue`, D-R57) — every active or
// completed enrollment with its final grade (percent, band, pass, stale), its
// issued certificate and, in the server's words, why an issuing request would
// skip it now (D-R52) — and, for holders of `certificates.issue`, the batch
// issue (POST /api/classes/:id/certificates — API-132) behind a confirmation:
// every eligible enrollment, or the ones ticked in the table. Certificates are
// issued for a completed class only, so before that the tab explains and
// issues nothing (`issuable` is 0). The tab shows the server's answers only:
// after an issue it reports the counts of the answer and reads the preview
// again; a refusal that cannot succeed again (the class is no longer
// completed, an enrollment left it — isStaleIssue) closes the dialog and reads
// the preview again too. The preview is read again whenever the class's
// status changes (completing the class from the drawer's menu).
import { PrinterOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { Alert, App, Button, Flex, Modal, Skeleton, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { issueClassCertificates, previewClassCertificates } from '../api/certificates'
import type { CertificatePreviewItem, ClassCertificates, IneligibleReason, IssueCertificatesInput, IssueCertificatesResult } from '../api/certificates'
import type { AcademyClass } from '../api/classes'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, formatDateTime, localizedLabel } from '../users/users.format'
import { describeCertificatesFailure, failureMessage, isStaleIssue } from './certificates.errors'
import { bandOf, formatPercent } from './certificates.format'
import { chosenEnrollmentIds, eligibleEnrollmentIds, issueBodyOf, issueOutcomeOf } from './certificates.issue'
import { certificatePrintPath } from './certificates.links'
import { canIssueCertificates } from './certificates.policy'

const REASON_COLORS: Readonly<Record<IneligibleReason, string>> = {
  already_issued: 'blue',
  not_completed: 'default',
  no_final_grade: 'gold',
  not_passed: 'red',
  stale: 'orange',
}

interface PreviewState {
  /** The request the state answers (the class, its status and the reload tick). */
  key: string
  preview: ClassCertificates | null
  error: unknown
}

export function ClassCertificatesTab({ cls }: { cls: AcademyClass }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canIssue = canIssueCertificates(hasPermission)
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState<PreviewState>({ key: '', preview: null, error: null })
  const [selected, setSelected] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  // Completing the class elsewhere in the drawer changes what can be issued: the status is part of the request.
  const requestKey = `${cls.id}:${cls.status}:${reloadTick}`
  const loading = state.key !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    previewClassCertificates(cls.id, controller.signal)
      .then((preview) => {
        if (!controller.signal.aborted) setState({ key: requestKey, preview, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((current) => ({ ...current, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [cls.id, requestKey])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  const preview = state.preview
  const failure = state.error ? describeCertificatesFailure(state.error) : null
  const eligible = preview ? eligibleEnrollmentIds(preview) : []
  const chosen = chosenEnrollmentIds(selected, eligible)
  const completed = preview?.class.status === 'completed'
  const count = chosen.length > 0 ? chosen.length : (preview?.issuable ?? 0)

  const issued = (result: IssueCertificatesResult) => {
    setConfirming(false)
    setSelected([])
    const outcome = issueOutcomeOf(result)
    if (outcome.issued === 0) message.info(t('certificates.classTab.issuedNone'))
    else if (outcome.skipped > 0) message.success(t('certificates.classTab.issuedSkipped', { count: outcome.issued, skipped: outcome.skipped }))
    else message.success(t('certificates.classTab.issued', { count: outcome.issued }))
    reload()
  }

  const columns: TableProps<CertificatePreviewItem>['columns'] = [
    {
      title: t('common.student'),
      key: 'student',
      render: (_, row) => (
        <Space size={4} wrap>
          <Typography.Text delete={row.student.deletedAt !== null}>{displayNameOf(row.student)}</Typography.Text>
          {row.student.deletedAt !== null ? <Tag>{t('classes.enrollments.deletedAccount')}</Tag> : null}
        </Space>
      ),
    },
    { title: t('certificates.classTab.columns.enrollment'), key: 'enrollment', render: (_, row) => <StatusTag value={row.enrollmentStatus} /> },
    {
      title: t('certificates.classTab.columns.final'),
      key: 'final',
      render: (_, row) =>
        row.final ? (
          <span>
            <bdi dir="ltr">{formatPercent(row.final.percent)}</bdi> <Typography.Text type="secondary">{bandOf(row.final, language)}</Typography.Text>
            <br />
            <Tag color={row.final.isPass ? 'green' : 'red'}>{t(row.final.isPass ? 'certificates.classTab.passed' : 'certificates.classTab.failed')}</Tag>
            {row.final.stale ? <Tag color="orange">{t('certificates.classTab.stale')}</Tag> : null}
          </span>
        ) : (
          <Typography.Text type="secondary">{t('certificates.classTab.noFinal')}</Typography.Text>
        ),
    },
    {
      title: t('certificates.classTab.columns.certificate'),
      key: 'certificate',
      render: (_, row) =>
        row.certificate ? (
          <span>
            <Typography.Text strong dir="ltr">
              {row.certificate.serial}
            </Typography.Text>{' '}
            <Button
              type="link"
              size="small"
              icon={<PrinterOutlined />}
              href={certificatePrintPath(row.certificate.id)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${t('certificates.drawer.print')}: ${row.certificate.serial}`}
            />
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTime(row.certificate.issuedAt, language)}
            </Typography.Text>
          </span>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: t('certificates.classTab.columns.eligibility'),
      key: 'eligibility',
      render: (_, row) =>
        row.reason ? (
          <Tag color={REASON_COLORS[row.reason] ?? 'default'}>{t(`certificates.classTab.reasons.${row.reason}`)}</Tag>
        ) : completed ? (
          <Tag color="green">{t('certificates.classTab.eligible')}</Tag>
        ) : (
          <Tag color="gold">{t('certificates.classTab.eligibleLater')}</Tag>
        ),
    },
  ]

  if (failure && !preview) {
    return (
      <Alert
        type="error"
        showIcon
        title={t('certificates.classTab.loadFailed')}
        description={failureMessage(t, failure)}
        action={
          <Button size="small" onClick={reload}>
            {t('certificates.refresh')}
          </Button>
        }
      />
    )
  }

  if (!preview) return <Skeleton active paragraph={{ rows: 4 }} data-testid="class-certificates-loading" />

  const selectable = canIssue && completed && eligible.length > 0

  return (
    <>
      <Typography.Paragraph type="secondary">{t('certificates.classTab.intro')}</Typography.Paragraph>

      {!completed ? (
        <Alert type="warning" showIcon title={t('certificates.classTab.notCompleted', { status: t(`labels.${preview.class.status}`) })} style={{ marginBottom: 12 }} />
      ) : null}

      {failure ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={reload}>
              {t('certificates.refresh')}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 12 }}>
        <Typography.Text data-testid="class-certificates-issuable">{t('certificates.classTab.issuable', { count: preview.issuable })}</Typography.Text>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={reload} loading={loading} aria-label={t('certificates.refresh')} />
          {canIssue ? (
            <Button type="primary" icon={<SafetyCertificateOutlined />} disabled={!completed || count === 0 || loading} onClick={() => setConfirming(true)}>
              {chosen.length > 0 ? t('certificates.classTab.issueSelected', { count: chosen.length }) : t('certificates.classTab.issueAll', { count: preview.issuable })}
            </Button>
          ) : null}
        </Space>
      </Flex>

      {!canIssue ? <Alert type="info" showIcon title={t('certificates.classTab.readOnlyHint')} style={{ marginBottom: 12 }} /> : null}

      <Table<CertificatePreviewItem>
        rowKey="enrollmentId"
        size="small"
        columns={columns}
        dataSource={preview.items}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('certificates.classTab.empty') }}
        rowSelection={
          selectable
            ? {
                selectedRowKeys: chosen,
                onChange: (keys) => setSelected(keys.map(String)),
                getCheckboxProps: (row) => ({ disabled: row.reason !== null, 'aria-label': t('certificates.classTab.choose', { name: displayNameOf(row.student) }) }),
              }
            : undefined
        }
      />

      {confirming ? (
        <IssueCertificatesModal
          // Mounted per confirmation, so an error never carries over.
          classId={cls.id}
          className={localizedLabel(preview.class.name, language)}
          body={issueBodyOf(chosen)}
          count={count}
          onDone={issued}
          onStale={() => {
            setConfirming(false)
            setSelected([])
            reload()
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  )
}

interface IssueCertificatesModalProps {
  classId: string
  className: string
  body: IssueCertificatesInput
  /** How many certificates the request is expected to create (the server decides). */
  count: number
  onDone: (result: IssueCertificatesResult) => void
  /** The request can no longer succeed (the message is already shown): close the dialog and read the preview again. */
  onStale: () => void
  onCancel: () => void
}

function IssueCertificatesModal({ classId, className, body, count, onDone, onStale, onCancel }: IssueCertificatesModalProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onDone(await issueClassCertificates(classId, body))
    } catch (caught) {
      const failure = describeCertificatesFailure(caught)
      const text = failureMessage(t, failure)
      if (isStaleIssue(failure)) {
        message.error(text)
        onStale()
        return
      }
      // Retryable (network, 5xx, 429) or refused (403): the dialog stays with the message.
      setError(text)
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={t('certificates.classTab.confirmTitle', { name: className })}
      okText={t('certificates.classTab.confirmOk')}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => void confirm()}
      onCancel={() => {
        if (!busy) onCancel()
      }}
    >
      <Typography.Paragraph>{t(body.enrollmentIds ? 'certificates.classTab.confirmSelected' : 'certificates.classTab.confirmAll', { count })}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{t('certificates.classTab.confirmNote')}</Typography.Paragraph>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Modal>
  )
}
