// Courses list (MOD-04-T05): GET /api/courses with search, level/status
// filters and keyset pagination; a detail drawer and a creation modal for
// holders of `courses.manage`, who also get a levels tab (MOD-04-T06). Holders of `courses.read` alone receive
// published courses only (D-R13) — the server decides, the page just hides
// what they cannot use.
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Input, Select, Space, Table, Tabs, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { COURSE_SEARCH_MAX_LENGTH, COURSE_STATUSES } from '../api/courses'
import type { Course } from '../api/courses'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { CourseDrawer } from '../courses/CourseDrawer'
import { CreateCourseModal } from '../courses/CreateCourseModal'
import { LevelsManager } from '../courses/LevelsManager'
import { describeCoursesFailure, failureMessage } from '../courses/courses.errors'
import { COURSE_PAGE_SIZES, useCoursesList } from '../courses/useCoursesList'
import type { CoursesListFilters } from '../courses/useCoursesList'
import { useLevels } from '../courses/useLevels'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime, localizedLabel } from '../users/users.format'

export function CoursesPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('courses.manage')
  const list = useCoursesList()
  const levelsState = useLevels()
  const { levels } = levelsState
  const [tab, setTab] = useState<'courses' | 'levels'>('courses')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const columns: TableProps<Course>['columns'] = [
    {
      title: t('courses.code'),
      key: 'code',
      render: (_, row) => (
        <Typography.Text dir="ltr" strong>
          {row.code}
        </Typography.Text>
      ),
    },
    { title: t('common.name'), key: 'name', render: (_, row) => localizedLabel(row.name, language) },
    { title: t('courses.level'), key: 'level', render: (_, row) => (row.level ? localizedLabel(row.level.name, language) : '—') },
    { title: t('common.status'), key: 'status', render: (_, row) => <StatusTag value={row.status} /> },
    { title: t('courses.columns.updatedAt'), key: 'updatedAt', render: (_, row) => formatDateTime(row.updatedAt, language) },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => setSelectedId(row.id)} aria-label={`${t('common.view')}: ${row.code}`}>
          {t('common.view')}
        </Button>
      ),
    },
  ]

  const failure = list.error ? describeCoursesFailure(list.error) : null

  const coursesCard = (
    <Card>
      <Flex gap={12} wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder={t('courses.searchPlaceholder')}
          aria-label={t('common.search')}
          maxLength={COURSE_SEARCH_MAX_LENGTH}
          defaultValue={list.filters.q}
          onSearch={(value) => list.setFilters({ q: value })}
          style={{ maxWidth: 320 }}
        />
        <Select<string>
          allowClear
          placeholder={t('courses.allLevels')}
          aria-label={t('courses.level')}
          value={list.filters.levelId}
          onChange={(value) => list.setFilters({ levelId: value })}
          options={levels.map((level) => ({ value: level.id, label: localizedLabel(level.name, language) }))}
          style={{ minWidth: 170 }}
        />
        {canManage ? (
          <Select<CoursesListFilters['status']>
            allowClear
            placeholder={t('courses.allStatuses')}
            aria-label={t('common.status')}
            value={list.filters.status}
            onChange={(value) => list.setFilters({ status: value })}
            options={COURSE_STATUSES.map((status) => ({ value: status, label: t(`labels.${status}`) }))}
            style={{ minWidth: 150 }}
          />
        ) : null}
        <Select<CoursesListFilters['sort']>
          value={list.filters.sort}
          aria-label={t('courses.sort')}
          onChange={(value) => list.setFilters({ sort: value })}
          options={[
            { value: 'code', label: t('courses.sortByCode') },
            { value: 'createdAt', label: t('courses.sortNewest') },
          ]}
          style={{ minWidth: 150 }}
        />
        <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('courses.refresh')} />
      </Flex>

      {failure ? (
        <Alert
          type="error"
          showIcon
          message={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={() => (failure.key.endsWith('cursor_invalid') ? list.setFilters({}) : list.reload())}>
              {t('courses.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Table<Course>
        rowKey="id"
        columns={columns}
        dataSource={list.items}
        loading={list.loading}
        pagination={false}
        locale={{ emptyText: t('courses.empty') }}
        onRow={(row) => ({ onClick: () => setSelectedId(row.id), style: { cursor: 'pointer' } })}
      />

      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
        <Space>
          <Typography.Text type="secondary">{t('courses.pagination.page', { page: list.pageNumber })}</Typography.Text>
          <Select<CoursesListFilters['limit']>
            size="small"
            value={list.filters.limit}
            onChange={(value) => list.setFilters({ limit: value })}
            options={COURSE_PAGE_SIZES.map((size) => ({ value: size, label: t('courses.pagination.pageSize', { count: size }) }))}
          />
        </Space>
        <Space>
          <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
            {t('courses.pagination.previous')}
          </Button>
          <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
            {t('courses.pagination.next')}
          </Button>
        </Space>
      </Flex>
    </Card>
  )

  return (
    <>
      <PageHeader
        title={t('courses.title')}
        subtitle={t('courses.subtitle')}
        extra={
          canManage && tab === 'courses' ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              {t('courses.addCourse')}
            </Button>
          ) : null
        }
      />

      {!canManage ? <Alert type="info" showIcon message={t('courses.readOnlyHint')} style={{ marginBottom: 16 }} /> : null}
      {canManage ? (
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as 'courses' | 'levels')}
          items={[
            { key: 'courses', label: t('courses.tabs.courses'), children: coursesCard },
            // A level renamed, deactivated or deleted changes the level column of the courses list.
            { key: 'levels', label: t('courses.tabs.levels'), children: <LevelsManager state={levelsState} onChanged={list.reload} /> },
          ]}
        />
      ) : (
        coursesCard
      )}

      <CourseDrawer
        courseId={selectedId}
        levels={levels}
        onClose={() => setSelectedId(null)}
        onUpdated={list.replaceItem}
        onDeleted={list.removeItem}
      />

      <CreateCourseModal
        open={creating}
        levels={levels}
        onClose={() => setCreating(false)}
        onCreated={(course) => {
          setCreating(false)
          list.reload()
          setSelectedId(course.id)
          message.success(t('courses.create.created', { name: localizedLabel(course.name, language) }))
        }}
      />
    </>
  )
}
