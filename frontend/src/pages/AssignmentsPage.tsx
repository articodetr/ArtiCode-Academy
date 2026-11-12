// Assignments list (MOD-08 — J-F38): GET /api/assignments (API-102) with
// class/status/due-date filters, an order (by due date, assignments without
// one last) and keyset pagination; a detail drawer and a creation modal for
// holders of `assignments.manage`. Holders of `assignments.read` without
// `classes.manage` (teachers by seed) receive only the assignments of the
// classes they are assigned to (D-R16) — the server decides, the page only
// hides what they cannot use. Students and guardians hold `assignments.read`
// by seed but are assigned to no class, so the navigation keeps them out
// (their own assignments come with «my assignments», API-112 — MOD-08-T04).
// Every due date is shown in the assignment's own zone (D-R41), named when it
// is not this device's; the due-date filter reads its days in the academy's
// zone (assignments.zone.ts) — again once that zone arrives, for a day picked
// before it (J-F56).
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Select, Space, Table, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import type { Assignment } from '../api/assignments'
import { AssignmentDrawer } from '../assignments/AssignmentDrawer'
import { CreateAssignmentModal } from '../assignments/CreateAssignmentModal'
import { describeAssignmentsFailure, failureMessage, isAssignmentsFailure } from '../assignments/assignments.errors'
import { assignmentTitle, formatZonedDateTime, submissionsRatio } from '../assignments/assignments.format'
import { academyZoneOf, differsFromDevice } from '../assignments/assignments.zone'
import { ASSIGNMENT_FILTER_STATUSES, ASSIGNMENT_PAGE_SIZES, defaultAssignmentFilters, hasActiveAssignmentFilters, useAssignmentsList } from '../assignments/useAssignmentsList'
import type { AssignmentsListFilters } from '../assignments/useAssignmentsList'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { ClassPicker } from '../timetable/TimetablePickers'
import { isCalendarDate } from '../timetable/timetable.dates'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { localizedLabel } from '../users/users.format'

function DateFilter({ value, onChange, label }: { value: string | undefined; onChange: (value: string | undefined) => void; label: string }) {
  return <input type="date" aria-label={label} className="ant-input" value={value ?? ''} onChange={(event) => onChange(isCalendarDate(event.target.value) ? event.target.value : undefined)} style={{ width: 170 }} />
}

export function AssignmentsPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const { academy } = useAcademy()
  const canManage = hasPermission('assignments.manage')
  const seesEveryClass = hasPermission('classes.manage')
  // GET /api/classes needs classes.read at the controller (classes.manage alone gets 403): the class filter and the
  // class picker of a new assignment follow it.
  const canPickClass = hasPermission('classes.read')
  // The due-date filter reads its days in the academy's zone, this device's until it is known.
  const filterZone = academyZoneOf(academy) ?? deviceTimeZone()
  const [defaults] = useState(() => defaultAssignmentFilters(filterZone))
  const list = useAssignmentsList(defaults)
  // A due day picked before the academy's zone arrived was read in this device's zone: once the zone is known (or
  // changes) the days are read again in it, so the request agrees with the zone the page names (the owner's note 3 on
  // #87). Without a day the zone narrows nothing, and nothing is asked again. Adjusted in the render that sees the
  // change — React's pattern for state that follows a value — so only the final filters are requested.
  if ((list.filters.dueFrom || list.filters.dueTo) && list.filters.timeZone !== filterZone) list.setFilters({ timeZone: filterZone })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const columns: TableProps<Assignment>['columns'] = [
    {
      title: t('assignments.columns.due'),
      key: 'due',
      render: (_, row) =>
        row.dueAt ? (
          <span>
            <Typography.Text>{formatZonedDateTime(row.dueAt, row.timeZone, language)}</Typography.Text>
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
          <Typography.Text type="secondary">{t('assignments.drawer.noDue')}</Typography.Text>
        ),
    },
    {
      title: t('assignments.columns.assignment'),
      key: 'assignment',
      render: (_, row) => (
        <span>
          <Typography.Text strong>{assignmentTitle(row, language)}</Typography.Text>
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
    {
      title: t('assignments.columns.class'),
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
    { title: t('assignments.columns.course'), key: 'course', render: (_, row) => localizedLabel(row.class.course.name, language) },
    {
      title: t('assignments.columns.submissions'),
      key: 'submissions',
      render: (_, row) => (
        <span>
          <span dir="ltr">{submissionsRatio(row)}</span>
          {row.submissions.submitted > 0 ? (
            <>
              <br />
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                {t('assignments.submissions.submitted', { count: row.submissions.submitted })}
              </Typography.Text>
            </>
          ) : null}
        </span>
      ),
    },
    { title: t('assignments.columns.status'), key: 'status', render: (_, row) => <StatusTag value={row.status} /> },
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
          aria-label={`${t('common.view')}: ${assignmentTitle(row, language)}`}
        >
          {t('common.view')}
        </Button>
      ),
    },
  ]

  const failure = list.error ? describeAssignmentsFailure(list.error) : null
  const emptyText = hasActiveAssignmentFilters(list.filters) ? t('assignments.emptyFiltered') : seesEveryClass ? t('assignments.empty') : t('assignments.emptyAssigned')

  return (
    <>
      <PageHeader
        title={t('assignments.title')}
        subtitle={t('assignments.subtitle')}
        extra={
          canManage ? (
            // A disabled button swallows the pointer events, so the hint sits on a wrapper.
            <Tooltip title={canPickClass ? undefined : t('assignments.hints.needsClassesRead')}>
              <span style={{ display: 'inline-block' }}>
                <Button type="primary" icon={<PlusOutlined />} disabled={!canPickClass} onClick={() => setCreating(true)}>
                  {t('assignments.addAssignment')}
                </Button>
              </span>
            </Tooltip>
          ) : null
        }
      />

      {!seesEveryClass ? <Alert type="info" showIcon title={t('assignments.readOnlyHint')} style={{ marginBottom: 16 }} /> : null}

      <Card>
        <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
          {canPickClass ? (
            <ClassPicker
              allowClear
              placeholder={t('assignments.filters.allClasses')}
              aria-label={t('assignments.columns.class')}
              value={list.filters.classId}
              onChange={(value) => list.setFilters({ classId: value })}
              style={{ minWidth: 240 }}
            />
          ) : null}
          <Select<AssignmentsListFilters['status']>
            allowClear
            placeholder={t('assignments.filters.allStatuses')}
            aria-label={t('assignments.columns.status')}
            value={list.filters.status}
            onChange={(value) => list.setFilters({ status: value })}
            options={ASSIGNMENT_FILTER_STATUSES.map((status) => ({ value: status, label: t(`labels.${status}`) }))}
            style={{ minWidth: 150 }}
          />
          <DateFilter label={t('assignments.filters.dueFrom')} value={list.filters.dueFrom} onChange={(value) => list.setFilters({ dueFrom: value, timeZone: filterZone })} />
          <DateFilter label={t('assignments.filters.dueTo')} value={list.filters.dueTo} onChange={(value) => list.setFilters({ dueTo: value, timeZone: filterZone })} />
          <Select<AssignmentsListFilters['order']>
            value={list.filters.order}
            aria-label={t('assignments.filters.order')}
            onChange={(value) => list.setFilters({ order: value })}
            options={[
              { value: 'asc', label: t('assignments.filters.orderAsc') },
              { value: 'desc', label: t('assignments.filters.orderDesc') },
            ]}
            style={{ minWidth: 170 }}
          />
          <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('assignments.refresh')} />
          {differsFromDevice(filterZone) ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }} data-testid="assignment-filter-zone">
              {t('assignments.filters.zone')} (<span dir="ltr">{filterZone}</span>)
            </Typography.Text>
          ) : null}
        </Flex>

        {failure ? (
          <Alert
            type="error"
            showIcon
            title={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={() => (isAssignmentsFailure(failure, 'cursor_invalid') ? list.setFilters({}) : list.reload())}>
                {t('assignments.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<Assignment>
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
            <Typography.Text type="secondary">{t('assignments.pagination.page', { page: list.pageNumber })}</Typography.Text>
            <Select<AssignmentsListFilters['limit']>
              size="small"
              value={list.filters.limit}
              aria-label={t('assignments.pagination.pageSizeLabel')}
              onChange={(value) => list.setFilters({ limit: value })}
              options={ASSIGNMENT_PAGE_SIZES.map((size) => ({ value: size, label: t('assignments.pagination.pageSize', { count: size }) }))}
            />
          </Space>
          <Space>
            <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
              {t('assignments.pagination.previous')}
            </Button>
            <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
              {t('assignments.pagination.next')}
            </Button>
          </Space>
        </Flex>
      </Card>

      <AssignmentDrawer assignmentId={selectedId} onClose={() => setSelectedId(null)} onUpdated={list.replaceItem} onDeleted={list.removeItem} />

      <CreateAssignmentModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false)
          list.reload()
          setSelectedId(created.id)
          message.success(t('assignments.create.created', { title: assignmentTitle(created, language) }))
        }}
      />
    </>
  )
}
