// Certificates list (MOD-10 — J-F51): GET /api/certificates (API-130) for the
// holders of `certificates.read_all` or `certificates.issue` (D-R57 — the admin
// and the staff by seed), academy-wide: newest first in keyset pages, with a
// search on part of the serial and the status, class, course and student
// filters of the contract (each picker only for whoever may read its list:
// `classes.read`, `courses.read`, `users.read`). A row opens the certificate's
// drawer (API-131) — print, and revoke for `certificates.revoke` (API-133). A
// certificate is issued from the «certificates» tab of a completed class
// (ClassCertificatesTab — API-136/API-132), never here. Every number and name
// is the server's.
import { PrinterOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Flex, Input, Select, Space, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CERTIFICATE_QUERY_MAX_LENGTH, CERTIFICATE_STATUSES } from '../api/certificates'
import type { Certificate } from '../api/certificates'
import { useAuth } from '../auth/auth-context'
import { CertificateDrawer } from '../certificates/CertificateDrawer'
import { CertificateStatusTag } from '../certificates/CertificateStatusTag'
import { describeCertificatesFailure, failureMessage, isCertificatesFailure } from '../certificates/certificates.errors'
import { bandOf, formatPercent } from '../certificates/certificates.format'
import { certificatePrintPath } from '../certificates/certificates.links'
import { CERTIFICATE_PAGE_SIZES, defaultCertificateFilters, hasActiveCertificateFilters, useCertificatesList } from '../certificates/useCertificatesList'
import type { CertificatesListFilters } from '../certificates/useCertificatesList'
import { CoursePicker, StudentPicker } from '../classes/ClassPickers'
import { PageHeader } from '../components/PageHeader'
import { useLocalized } from '../i18n/useLocalized'
import { ClassPicker } from '../timetable/TimetablePickers'
import { displayNameOf, formatDateTime, localizedLabel } from '../users/users.format'

export function CertificatesPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  // GET /api/classes, /api/courses and /api/users need these keys at the controller: each picker follows its key.
  const canPickClass = hasPermission('classes.read')
  const canPickCourse = hasPermission('courses.read')
  const canPickStudent = hasPermission('users.read')
  const [defaults] = useState(defaultCertificateFilters)
  const list = useCertificatesList(defaults)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const columns: TableProps<Certificate>['columns'] = [
    {
      title: t('certificates.columns.serial'),
      key: 'serial',
      render: (_, row) => (
        <Typography.Text strong dir="ltr">
          {row.serial}
        </Typography.Text>
      ),
    },
    {
      title: t('common.student'),
      key: 'student',
      render: (_, row) => (
        <span>
          <span>{displayNameOf(row.student)}</span>
          {row.student.fullNameLatin ? (
            <>
              <br />
              <Typography.Text type="secondary" dir="ltr" style={{ fontSize: 12 }}>
                {row.student.fullNameLatin}
              </Typography.Text>
            </>
          ) : null}
        </span>
      ),
    },
    {
      title: t('common.course'),
      key: 'course',
      render: (_, row) => (
        <span>
          <span>{localizedLabel(row.course.name, language)}</span>
          <br />
          <Typography.Text type="secondary" dir="ltr" style={{ fontSize: 12 }}>
            {row.course.code}
          </Typography.Text>
        </span>
      ),
    },
    {
      title: t('certificates.columns.class'),
      key: 'class',
      render: (_, row) => (
        <span>
          <Typography.Text dir="ltr">{row.class.code}</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {localizedLabel(row.class.name, language)}
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
    {
      title: t('common.status'),
      key: 'status',
      render: (_, row) => (
        <span>
          <CertificateStatusTag status={row.status} />
          {row.status === 'revoked' && row.revokedAt ? (
            <>
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {formatDateTime(row.revokedAt, language)}
              </Typography.Text>
            </>
          ) : null}
        </span>
      ),
    },
    { title: t('certificates.columns.issuedAt'), key: 'issuedAt', render: (_, row) => formatDateTime(row.issuedAt, language) },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => (
        <Space size={4} onClick={(event) => event.stopPropagation()}>
          <Button type="link" size="small" onClick={() => setSelectedId(row.id)} aria-label={`${t('common.view')}: ${row.serial}`}>
            {t('common.view')}
          </Button>
          <Button
            type="link"
            size="small"
            icon={<PrinterOutlined />}
            href={certificatePrintPath(row.id)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${t('certificates.drawer.print')}: ${row.serial}`}
          />
        </Space>
      ),
    },
  ]

  const failure = list.error ? describeCertificatesFailure(list.error) : null
  const emptyText = hasActiveCertificateFilters(list.filters) ? t('certificates.emptyFiltered') : t('certificates.empty')

  return (
    <>
      <PageHeader title={t('certificates.title')} subtitle={t('certificates.subtitle')} />

      <Alert type="info" showIcon title={t('certificates.issueHint')} style={{ marginBottom: 16 }} />

      <Card>
        <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder={t('certificates.filters.searchPlaceholder')}
            aria-label={t('certificates.filters.search')}
            maxLength={CERTIFICATE_QUERY_MAX_LENGTH}
            defaultValue={list.filters.q}
            onSearch={(value) => list.setFilters({ q: value.trim() || undefined })}
            style={{ maxWidth: 260 }}
          />
          <Select<CertificatesListFilters['status']>
            allowClear
            placeholder={t('certificates.filters.allStatuses')}
            aria-label={t('common.status')}
            value={list.filters.status}
            onChange={(value) => list.setFilters({ status: value })}
            options={CERTIFICATE_STATUSES.map((status) => ({ value: status, label: t(`certificates.status.${status}`) }))}
            style={{ minWidth: 150 }}
          />
          {canPickClass ? (
            <ClassPicker
              allowClear
              placeholder={t('certificates.filters.allClasses')}
              aria-label={t('certificates.columns.class')}
              value={list.filters.classId}
              onChange={(value) => list.setFilters({ classId: value })}
              style={{ minWidth: 220 }}
            />
          ) : null}
          {canPickCourse ? (
            <CoursePicker
              allowClear
              placeholder={t('certificates.filters.allCourses')}
              aria-label={t('common.course')}
              value={list.filters.courseId}
              onChange={(value) => list.setFilters({ courseId: value })}
              style={{ minWidth: 220 }}
            />
          ) : null}
          {canPickStudent ? (
            <StudentPicker
              allowClear
              placeholder={t('certificates.filters.allStudents')}
              aria-label={t('common.student')}
              value={list.filters.studentId}
              onChange={(value) => list.setFilters({ studentId: value })}
              style={{ minWidth: 200 }}
            />
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('certificates.refresh')} />
        </Flex>

        {failure ? (
          <Alert
            type="error"
            showIcon
            title={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={() => (isCertificatesFailure(failure, 'cursor_invalid') ? list.setFilters({}) : list.reload())}>
                {t('certificates.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<Certificate>
          rowKey="id"
          columns={columns}
          dataSource={list.items}
          loading={list.loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText }}
          onRow={(row) => ({ onClick: () => setSelectedId(row.id), style: { cursor: 'pointer' } })}
        />

        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
          <Space>
            <Typography.Text type="secondary">{t('certificates.pagination.page', { page: list.pageNumber })}</Typography.Text>
            <Select<CertificatesListFilters['limit']>
              size="small"
              value={list.filters.limit}
              aria-label={t('certificates.pagination.pageSizeLabel')}
              onChange={(value) => list.setFilters({ limit: value })}
              options={CERTIFICATE_PAGE_SIZES.map((size) => ({ value: size, label: t('certificates.pagination.pageSize', { count: size }) }))}
            />
          </Space>
          <Space>
            <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
              {t('certificates.pagination.previous')}
            </Button>
            <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
              {t('certificates.pagination.next')}
            </Button>
          </Space>
        </Flex>
      </Card>

      <CertificateDrawer certificateId={selectedId} onClose={() => setSelectedId(null)} onUpdated={list.replaceItem} />
    </>
  )
}
