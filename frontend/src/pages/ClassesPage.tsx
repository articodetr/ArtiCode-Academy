// Classes list (MOD-05 — J-F01): GET /api/classes with search, course/status
// (and, for managers, teacher) filters and keyset pagination; a detail drawer
// and a creation modal for holders of `classes.manage`. Holders of
// `classes.read` alone (teachers by seed) receive only the classes they are
// assigned to (D-R16) — the server decides, the page only hides what they
// cannot use. Enrollments come with J-F04.
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Input, Select, Space, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CLASS_SEARCH_MAX_LENGTH, CLASS_STATUSES } from '../api/classes'
import type { AcademyClass } from '../api/classes'
import { useAuth } from '../auth/auth-context'
import { ClassDrawer, SeatsBar } from '../classes/ClassDrawer'
import { CoursePicker, TeacherPicker } from '../classes/ClassPickers'
import { CreateClassModal } from '../classes/CreateClassModal'
import { describeClassesFailure, failureMessage } from '../classes/classes.errors'
import { CLASS_PAGE_SIZES, useClassesList } from '../classes/useClassesList'
import type { ClassesListFilters } from '../classes/useClassesList'
import { useDockedPanel } from '../common/useDockedPanel'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { formatDay, localizedLabel } from '../users/users.format'

export function ClassesPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('classes.manage')
  const canPickCourse = hasPermission('courses.read')
  const canPickTeacher = canManage && hasPermission('users.read')
  const list = useClassesList()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // Redesign (2026-11-14): on a wide screen the class opens in a side panel beside the table, not over it.
  const { docked, dockedIn, panelRef, wide, onUnsavedChange, open: openClass, layoutClassName } = useDockedPanel(selectedId, setSelectedId)

  const leadOf = (row: AcademyClass) => {
    if (row.teachers.length === 0) return <Typography.Text type="secondary">{t('classes.noTeacher')}</Typography.Text>
    const [first, ...others] = row.teachers
    return others.length > 0 ? `${first!.fullName} ${t('classes.moreTeachers', { count: others.length })}` : first!.fullName
  }

  const columns: TableProps<AcademyClass>['columns'] = [
    // Redesign (2026-11-14): the class's name and its code in one cell — the name first, the code under it.
    {
      title: t('common.name'),
      key: 'name',
      render: (_, row) => (
        <span className="list-primary">
          <b>{localizedLabel(row.name, language)}</b>
          <bdi dir="ltr">{row.code}</bdi>
        </span>
      ),
    },
    { title: t('common.course'), key: 'course', render: (_, row) => localizedLabel(row.course.name, language) },
    { title: t('classes.columns.teachers'), key: 'teachers', render: (_, row) => leadOf(row) },
    { title: t('classes.columns.seats'), key: 'seats', render: (_, row) => <SeatsBar cls={row} /> },
    { title: t('common.status'), key: 'status', render: (_, row) => <StatusTag value={row.status} /> },
    {
      title: t('classes.columns.dates'),
      key: 'dates',
      render: (_, row) => (row.startsOn || row.endsOn ? `${formatDay(row.startsOn, language)} – ${formatDay(row.endsOn, language)}` : '—'),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          onClick={(event) => {
            event.stopPropagation()
            openClass(row.id)
          }}
          aria-label={`${t('common.view')}: ${row.code}`}
        >
          {t('common.view')}
        </Button>
      ),
    },
  ]

  const failure = list.error ? describeClassesFailure(list.error) : null
  const filtered = Boolean(list.filters.q || list.filters.status || list.filters.courseId || list.filters.teacherId)
  const emptyText = filtered ? t('classes.emptyFiltered') : canManage ? t('classes.empty') : t('classes.emptyAssigned')

  return (
    <>
      <PageHeader
        title={t('classes.title')}
        subtitle={t('classes.subtitle')}
        extra={
          canManage ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              {t('classes.addClass')}
            </Button>
          ) : null
        }
      />

      {!canManage ? <Alert type="info" showIcon message={t('classes.readOnlyHint')} style={{ marginBottom: 16 }} /> : null}

      <div className={layoutClassName}>
      <Card className="list-with-panel__main">
        <Flex gap={12} wrap style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder={t('classes.searchPlaceholder')}
            aria-label={t('common.search')}
            maxLength={CLASS_SEARCH_MAX_LENGTH}
            defaultValue={list.filters.q}
            onSearch={(value) => list.setFilters({ q: value })}
            style={{ maxWidth: 320 }}
          />
          {canPickCourse ? (
            <CoursePicker
              allowClear
              placeholder={t('classes.allCourses')}
              aria-label={t('common.course')}
              value={list.filters.courseId}
              onChange={(value) => list.setFilters({ courseId: value })}
              style={{ minWidth: 220 }}
            />
          ) : null}
          <Select<ClassesListFilters['status']>
            allowClear
            placeholder={t('classes.allStatuses')}
            aria-label={t('common.status')}
            value={list.filters.status}
            onChange={(value) => list.setFilters({ status: value })}
            options={CLASS_STATUSES.map((status) => ({ value: status, label: t(`labels.${status}`) }))}
            style={{ minWidth: 150 }}
          />
          {canPickTeacher ? (
            <TeacherPicker
              allowClear
              placeholder={t('classes.allTeachers')}
              aria-label={t('common.teacher')}
              value={list.filters.teacherId}
              onChange={(value) => list.setFilters({ teacherId: value })}
              style={{ minWidth: 200 }}
            />
          ) : null}
          <Select<ClassesListFilters['sort']>
            value={list.filters.sort}
            aria-label={t('classes.sort')}
            onChange={(value) => list.setFilters({ sort: value })}
            options={[
              { value: 'code', label: t('classes.sortByCode') },
              { value: 'createdAt', label: t('classes.sortNewest') },
            ]}
            style={{ minWidth: 150 }}
          />
          <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('classes.refresh')} />
        </Flex>

        {failure ? (
          <Alert
            type="error"
            showIcon
            message={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={() => (failure.key.endsWith('cursor_invalid') ? list.setFilters({}) : list.reload())}>
                {t('classes.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<AcademyClass>
          rowKey="id"
          // With the side panel open the table keeps the columns that tell classes apart; the panel shows the rest.
          columns={docked ? columns.filter((column) => ['name', 'teachers', 'seats', 'status'].includes(String(column.key))) : columns}
          dataSource={list.items}
          loading={list.loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText }}
          onRow={(row) => ({ onClick: () => openClass(row.id), style: { cursor: 'pointer' } })}
          rowClassName={(row) => (row.id === selectedId ? 'list-row--open' : '')}
        />

        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
          <Space>
            <Typography.Text type="secondary">{t('classes.pagination.page', { page: list.pageNumber })}</Typography.Text>
            <Select<ClassesListFilters['limit']>
              size="small"
              value={list.filters.limit}
              aria-label={t('classes.pagination.pageSizeLabel')}
              onChange={(value) => list.setFilters({ limit: value })}
              options={CLASS_PAGE_SIZES.map((size) => ({ value: size, label: t('classes.pagination.pageSize', { count: size }) }))}
            />
          </Space>
          <Space>
            <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
              {t('classes.pagination.previous')}
            </Button>
            <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
              {t('classes.pagination.next')}
            </Button>
          </Space>
        </Flex>
      </Card>
      {wide ? <aside ref={panelRef} className="list-panel" aria-hidden={!docked} /> : null}
      </div>

      <ClassDrawer
        key={docked ? selectedId : 'overlay'}
        classId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdated={list.replaceItem}
        onDeleted={list.removeItem}
        dockedIn={dockedIn}
        onUnsavedChange={onUnsavedChange}
      />

      <CreateClassModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false)
          list.reload()
          setSelectedId(created.id)
          message.success(t('classes.create.created', { name: localizedLabel(created.name, language) }))
        }}
      />
    </>
  )
}
