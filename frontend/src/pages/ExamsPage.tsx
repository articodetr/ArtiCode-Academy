// Exams list (MOD-09 — J-F45): GET /api/exams (API-113) with class, status,
// type and date filters, an order (by exam date, undated exams last) and
// keyset pagination; a detail drawer with the results sheet and a creation
// modal for holders of `exams.manage`. Holders of `exams.read` without
// `classes.manage` (teachers by seed) receive only the exams of the classes
// they are assigned to (D-R16) — the server decides, the page only hides what
// they cannot use. Students and guardians hold `exams.read` by seed but are
// assigned to no class, so the navigation keeps them out (their own exams come
// with «my exams», API-121 — a later part of MOD-09-T08). Every exam date is
// shown in the exam's own zone (D-R41), named when it is not this device's;
// the date filter reads its days in the academy's zone. Every number is the
// server's — the page computes no grade (MOD-09-T08).
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Select, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import { EXAM_STATUSES, EXAM_TYPES } from '../api/exams'
import type { Exam } from '../api/exams'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { academyZoneOf, differsFromDevice } from '../assignments/assignments.zone'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { CreateExamModal } from '../exams/CreateExamModal'
import { ExamDrawer } from '../exams/ExamDrawer'
import { describeExamsFailure, failureMessage, isExamsFailure } from '../exams/exams.errors'
import { examTitle, resultsRatio } from '../exams/exams.format'
import { EXAM_PAGE_SIZES, defaultExamFilters, hasActiveExamFilters, useExamsList } from '../exams/useExamsList'
import type { ExamsListFilters } from '../exams/useExamsList'
import { useLocalized } from '../i18n/useLocalized'
import { ClassPicker } from '../timetable/TimetablePickers'
import { isCalendarDate } from '../timetable/timetable.dates'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { localizedLabel } from '../users/users.format'

function DateFilter({ value, onChange, label }: { value: string | undefined; onChange: (value: string | undefined) => void; label: string }) {
  return <input type="date" aria-label={label} className="ant-input" value={value ?? ''} onChange={(event) => onChange(isCalendarDate(event.target.value) ? event.target.value : undefined)} style={{ width: 170 }} />
}

export function ExamsPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const { academy } = useAcademy()
  const canManage = hasPermission('exams.manage')
  const seesEveryClass = hasPermission('classes.manage')
  // GET /api/classes needs classes.read at the controller (classes.manage alone gets 403): the class filter and the
  // class picker of a new exam follow it.
  const canPickClass = hasPermission('classes.read')
  // The date filter reads its days in the academy's zone, this device's until it is known.
  const filterZone = academyZoneOf(academy) ?? deviceTimeZone()
  const [defaults] = useState(() => defaultExamFilters(filterZone))
  const list = useExamsList(defaults)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const columns: TableProps<Exam>['columns'] = [
    {
      title: t('exams.columns.scheduledAt'),
      key: 'scheduledAt',
      render: (_, row) =>
        row.scheduledAt ? (
          <span>
            <Typography.Text>{formatZonedDateTime(row.scheduledAt, row.timeZone, language)}</Typography.Text>
            {row.durationMinutes !== null ? (
              <>
                <br />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('exams.drawer.minutes', { count: row.durationMinutes })}
                </Typography.Text>
              </>
            ) : null}
            {differsFromDevice(row.timeZone) ? (
              <>
                <br />
                <span dir="ltr" style={{ fontSize: 12, opacity: 0.65 }}>
                  {row.timeZone}
                </span>
              </>
            ) : null}
          </span>
        ) : (
          <Typography.Text type="secondary">{t('exams.drawer.noDate')}</Typography.Text>
        ),
    },
    {
      title: t('exams.columns.exam'),
      key: 'exam',
      render: (_, row) => (
        <span>
          <Typography.Text strong>{examTitle(row, language)}</Typography.Text>
          {row.lesson ? (
            <>
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {localizedLabel(row.lesson.title, language)}
              </Typography.Text>
            </>
          ) : null}
        </span>
      ),
    },
    { title: t('exams.columns.type'), key: 'type', render: (_, row) => <Tag>{t(`exams.types.${row.type}`)}</Tag> },
    {
      title: t('exams.columns.class'),
      key: 'class',
      render: (_, row) => (
        <span>
          <Typography.Text dir="ltr" strong>
            {row.class.code}
          </Typography.Text>
          <br />
          <Typography.Text type="secondary">{localizedLabel(row.class.name, language)}</Typography.Text>
        </span>
      ),
    },
    { title: t('exams.columns.course'), key: 'course', render: (_, row) => localizedLabel(row.class.course.name, language) },
    {
      title: t('exams.columns.results'),
      key: 'results',
      render: (_, row) => (
        <span>
          <span dir="ltr">{resultsRatio(row)}</span>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('exams.columns.maxScoreOf', { max: row.maxScore })}
          </Typography.Text>
        </span>
      ),
    },
    { title: t('exams.columns.status'), key: 'status', render: (_, row) => <StatusTag value={row.status} /> },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          onClick={(event) => {
            event.stopPropagation()
            setSelectedId(row.id)
          }}
          aria-label={`${t('common.view')}: ${examTitle(row, language)}`}
        >
          {t('common.view')}
        </Button>
      ),
    },
  ]

  const failure = list.error ? describeExamsFailure(list.error) : null
  const emptyText = hasActiveExamFilters(list.filters) ? t('exams.emptyFiltered') : seesEveryClass ? t('exams.empty') : t('exams.emptyAssigned')

  return (
    <>
      <PageHeader
        title={t('exams.title')}
        subtitle={t('exams.subtitle')}
        extra={
          canManage ? (
            // A disabled button swallows the pointer events, so the hint sits on a wrapper.
            <Tooltip title={canPickClass ? undefined : t('exams.hints.needsClassesRead')}>
              <span style={{ display: 'inline-block' }}>
                <Button type="primary" icon={<PlusOutlined />} disabled={!canPickClass} onClick={() => setCreating(true)}>
                  {t('exams.addExam')}
                </Button>
              </span>
            </Tooltip>
          ) : null
        }
      />

      {!seesEveryClass ? <Alert type="info" showIcon title={t('exams.readOnlyHint')} style={{ marginBottom: 16 }} /> : null}

      <Card>
        <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
          {canPickClass ? (
            <ClassPicker
              allowClear
              placeholder={t('exams.filters.allClasses')}
              aria-label={t('exams.columns.class')}
              value={list.filters.classId}
              onChange={(value) => list.setFilters({ classId: value })}
              style={{ minWidth: 240 }}
            />
          ) : null}
          <Select<ExamsListFilters['status']>
            allowClear
            placeholder={t('exams.filters.allStatuses')}
            aria-label={t('exams.columns.status')}
            value={list.filters.status}
            onChange={(value) => list.setFilters({ status: value })}
            options={EXAM_STATUSES.map((status) => ({ value: status, label: t(`labels.${status}`) }))}
            style={{ minWidth: 150 }}
          />
          <Select<ExamsListFilters['type']>
            allowClear
            placeholder={t('exams.filters.allTypes')}
            aria-label={t('exams.columns.type')}
            value={list.filters.type}
            onChange={(value) => list.setFilters({ type: value })}
            options={EXAM_TYPES.map((type) => ({ value: type, label: t(`exams.types.${type}`) }))}
            style={{ minWidth: 170 }}
          />
          <DateFilter label={t('exams.filters.from')} value={list.filters.from} onChange={(value) => list.setFilters({ from: value, timeZone: filterZone })} />
          <DateFilter label={t('exams.filters.to')} value={list.filters.to} onChange={(value) => list.setFilters({ to: value, timeZone: filterZone })} />
          <Select<ExamsListFilters['order']>
            value={list.filters.order}
            aria-label={t('exams.filters.order')}
            onChange={(value) => list.setFilters({ order: value })}
            options={[
              { value: 'asc', label: t('exams.filters.orderAsc') },
              { value: 'desc', label: t('exams.filters.orderDesc') },
            ]}
            style={{ minWidth: 170 }}
          />
          <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('exams.refresh')} />
          {differsFromDevice(filterZone) ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }} data-testid="exam-filter-zone">
              {t('exams.filters.zone')} (<span dir="ltr">{filterZone}</span>)
            </Typography.Text>
          ) : null}
        </Flex>
        {list.filters.from || list.filters.to ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
            {t('exams.filters.undatedHint')}
          </Typography.Paragraph>
        ) : null}

        {failure ? (
          <Alert
            type="error"
            showIcon
            title={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={() => (isExamsFailure(failure, 'cursor_invalid') ? list.setFilters({}) : list.reload())}>
                {t('exams.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<Exam>
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
            <Typography.Text type="secondary">{t('exams.pagination.page', { page: list.pageNumber })}</Typography.Text>
            <Select<ExamsListFilters['limit']>
              size="small"
              value={list.filters.limit}
              aria-label={t('exams.pagination.pageSizeLabel')}
              onChange={(value) => list.setFilters({ limit: value })}
              options={EXAM_PAGE_SIZES.map((size) => ({ value: size, label: t('exams.pagination.pageSize', { count: size }) }))}
            />
          </Space>
          <Space>
            <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
              {t('exams.pagination.previous')}
            </Button>
            <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
              {t('exams.pagination.next')}
            </Button>
          </Space>
        </Flex>
      </Card>

      <ExamDrawer examId={selectedId} onClose={() => setSelectedId(null)} onUpdated={list.replaceItem} onDeleted={list.removeItem} />

      <CreateExamModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false)
          list.reload()
          setSelectedId(created.id)
          message.success(t('exams.create.created', { title: examTitle(created, language) }))
        }}
      />
    </>
  )
}
