// «My certificates» (MOD-10 — J-F51): GET /api/me/certificates (API-135) for a
// student (their own certificates with `certificates.read_own`, `relation:
// self`) and a guardian (their linked children's with `certificates.read_linked`
// while they hold the `guardian` role, `relation: child` — the server decides,
// D-R57). The route opens to the holders of the `student` or `guardian` server
// role key (nav entry `myCertificates`, like «my classes»); a caller without
// either certificates key gets the server's 403 message. Issued and revoked
// certificates, newest first: the serial, the course, the class and the grade
// of the certificate, the day it was issued and — once revoked — the day of
// the revocation, never its reason, the issuer or the revoker (the DTO does
// not carry them). Each certificate opens its print page in a new tab (built
// from the snapshot — D-R50) and copies its public verification link. A
// guardian, or whoever owns certificates through more than one student, gets a
// student column and filter.
import { CheckOutlined, LinkOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Flex, Select, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MyCertificateItem } from '../api/myCertificates'
import { useAuth } from '../auth/auth-context'
import { CertificateStatusTag } from '../certificates/CertificateStatusTag'
import { describeCertificatesFailure, failureMessage } from '../certificates/certificates.errors'
import { bandOf, formatPercent } from '../certificates/certificates.format'
import { myCertificatePrintPath, verificationUrl } from '../certificates/certificates.links'
import { certificateStudentOptions, certificatesOf, showsCertificateStudents } from '../certificates/myCertificates.view'
import { useMyCertificates } from '../certificates/useMyCertificates'
import { PageHeader } from '../components/PageHeader'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, formatDateTime, localizedLabel } from '../users/users.format'

export function MyCertificatesPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user } = useAuth()
  const my = useMyCertificates()
  const [studentId, setStudentId] = useState<string | undefined>(undefined)
  const students = certificateStudentOptions(my.items)
  const showStudent = showsCertificateStudents(user?.roles ?? [], my.items)
  // The filter helps whoever owns certificates through more than one student (a guardian, or a student who is also one).
  const canPickStudent = students.length > 1 || students.some((student) => student.relation === 'child')
  const items = certificatesOf(my.items, students.some((student) => student.id === studentId) ? studentId : undefined)

  const columns: TableProps<MyCertificateItem>['columns'] = [
    {
      title: t('certificates.columns.serial'),
      key: 'serial',
      render: (_, row) => (
        <span>
          <Typography.Text strong dir="ltr">
            {row.serial}
          </Typography.Text>
          <br />
          <CertificateStatusTag status={row.status} />
          {row.status === 'revoked' ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('certificates.my.revokedOn', { date: formatDateTime(row.revokedAt, language) })}
            </Typography.Text>
          ) : null}
        </span>
      ),
    },
    {
      title: t('common.course'),
      key: 'course',
      render: (_, row) => (
        <span>
          <span>{localizedLabel(row.snapshot.course.name, language)}</span>
          <br />
          <Typography.Text type="secondary" dir="ltr" style={{ fontSize: 12 }}>
            {row.snapshot.course.code}
          </Typography.Text>
        </span>
      ),
    },
    {
      title: t('certificates.columns.class'),
      key: 'class',
      render: (_, row) => (
        <span>
          <Typography.Text dir="ltr">{row.snapshot.class.code}</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {localizedLabel(row.snapshot.class.name, language)}
          </Typography.Text>
        </span>
      ),
    },
    {
      title: t('certificates.columns.grade'),
      key: 'grade',
      render: (_, row) => (
        <span>
          <bdi dir="ltr">{formatPercent(row.grade.percent)}</bdi>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {bandOf(row.grade, language)}
          </Typography.Text>
        </span>
      ),
    },
    { title: t('certificates.columns.issuedAt'), key: 'issuedAt', render: (_, row) => formatDateTime(row.issuedAt, language) },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => (
        <Space size={4} wrap>
          <Button size="small" icon={<PrinterOutlined />} href={myCertificatePrintPath(row.id)} target="_blank" rel="noopener noreferrer" aria-label={`${t('certificates.drawer.print')}: ${row.serial}`}>
            {t('certificates.drawer.print')}
          </Button>
          <Typography.Text
            copyable={{
              text: verificationUrl(row.verificationCode, window.location.origin),
              icon: [<LinkOutlined key="copy" />, <CheckOutlined key="copied" />],
              tooltips: [t('certificates.drawer.copyLink'), t('certificates.drawer.copied')],
            }}
          />
        </Space>
      ),
    },
  ]
  if (showStudent) {
    columns.splice(1, 0, {
      title: t('common.student'),
      key: 'student',
      render: (_, row) => (
        <Space size={4} wrap>
          <span>{displayNameOf(row.student)}</span>
          <Tag color={row.relation === 'self' ? 'green' : 'blue'}>{t(`myClasses.relation.${row.relation}`)}</Tag>
        </Space>
      ),
    })
  }

  const failure = my.error ? describeCertificatesFailure(my.error) : null

  return (
    <>
      <PageHeader title={t('certificates.my.title')} subtitle={t('certificates.my.subtitle')} />

      <Card>
        <Flex gap={12} wrap style={{ marginBottom: 16 }}>
          {canPickStudent ? (
            <Select<string | undefined>
              allowClear
              placeholder={t('certificates.filters.allStudents')}
              aria-label={t('common.student')}
              value={studentId}
              onChange={(value) => setStudentId(value)}
              options={students.map((student) => ({ value: student.id, label: `${student.name} — ${t(`myClasses.relation.${student.relation}`)}` }))}
              style={{ minWidth: 240 }}
            />
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={my.reload} aria-label={t('certificates.refresh')} />
        </Flex>

        {failure ? (
          <Alert
            type="error"
            showIcon
            title={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={my.reload}>
                {t('certificates.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<MyCertificateItem>
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={my.loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: t('certificates.my.empty') }}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          {t('certificates.my.hint')}
        </Typography.Paragraph>
      </Card>
    </>
  )
}
