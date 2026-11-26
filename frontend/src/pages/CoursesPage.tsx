// Courses list (MOD-04-T05): GET /api/courses with search, a status filter and keyset pagination; a detail drawer and
// a creation modal for holders of `courses.manage`. Holders of `courses.read` alone receive published courses only
// (D-R13) — the server decides, the page just hides what they cannot use.
// PORTAL-04-COURSE-ORDER: no levels or subjects tab, no level column or filter and no subject in the course form
// any more (the tables and the stored values stay); the list opens in the office's order («ترتيب العرض»,
// API-042 `sort=position`), the order the catalogs show, and a manager moves a course one place up or down with the
// arrows (POST /api/courses/:id/move). The arrows work only on the plain order — no search, no status filter — so a
// move is always between the rows the manager sees; every move reads the page again from the server.
import { ArrowDownOutlined, ArrowUpOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Input, Select, Space, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { COURSE_SEARCH_MAX_LENGTH, COURSE_STATUSES, moveCourse } from '../api/courses'
import type { Course, CourseMoveDirection } from '../api/courses'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { CourseDrawer } from '../courses/CourseDrawer'
import { CreateCourseModal } from '../courses/CreateCourseModal'
import { describeCoursesFailure, failureMessage } from '../courses/courses.errors'
import { canReorderCourses } from '../courses/courses.order'
import { COURSE_PAGE_SIZES, useCoursesList } from '../courses/useCoursesList'
import type { CoursesListFilters } from '../courses/useCoursesList'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime, localizedLabel } from '../users/users.format'
import { CREATE_COURSE, useCreateFromLink } from '../common/useCreateFromLink'
import { useOpenFromSearch } from '../common/useOpenFromSearch'

export function CoursesPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('courses.manage')
  const list = useCoursesList()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The course being moved: every arrow waits for its answer.
  const [movingId, setMovingId] = useState<string | null>(null)
  // The global search opens a record here through `?open=<id>`.
  useOpenFromSearch(setSelectedId)
  const [creating, setCreating] = useState(false)
  // `?create=course` opens the modal for a holder of courses.manage.
  useCreateFromLink((what) => {
    if (!canManage || what !== CREATE_COURSE) return
    setCreating(true)
  })

  const reorderable = canManage && canReorderCourses(list.filters)
  const lastIndex = list.items.length - 1

  async function move(row: Course, direction: CourseMoveDirection) {
    setMovingId(row.id)
    try {
      await moveCourse(row.id, direction)
    } catch (error) {
      const failure = describeCoursesFailure(error)
      message.error(failure.key.endsWith('course_not_found') ? failureMessage(t, failure) : t('courses.order.failed'))
    } finally {
      setMovingId(null)
      // The server's order, always: the page is read again (a course moved past the page's edge leaves it).
      list.reload()
    }
  }

  const orderColumn: NonNullable<TableProps<Course>['columns']>[number] = {
    title: t('courses.columns.order'),
    key: 'order',
    width: 104,
    render: (_, row, index) => {
      const name = localizedLabel(row.name, language)
      const busy = movingId !== null || list.loading
      // The very first course has nobody above it, the very last nobody below (the server would answer a no-op).
      const first = list.pageNumber === 1 && index === 0
      const last = list.nextCursor === null && index === lastIndex
      return (
        // A press on an arrow never opens the row's drawer.
        <Space size={4} onClick={(event) => event.stopPropagation()}>
          <Button
            size="small"
            icon={<ArrowUpOutlined />}
            aria-label={t('courses.order.up', { name })}
            disabled={!reorderable || busy || first}
            loading={movingId === row.id}
            onClick={() => void move(row, 'up')}
          />
          <Button size="small" icon={<ArrowDownOutlined />} aria-label={t('courses.order.down', { name })} disabled={!reorderable || busy || last} onClick={() => void move(row, 'down')} />
        </Space>
      )
    },
  }

  const columns: TableProps<Course>['columns'] = [
    ...(canManage ? [orderColumn] : []),
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

  return (
    <>
      <PageHeader
        title={t('courses.title')}
        subtitle={t('courses.subtitle')}
        extra={
          canManage ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              {t('courses.addCourse')}
            </Button>
          ) : null
        }
      />

      {!canManage ? <Alert type="info" showIcon message={t('courses.readOnlyHint')} style={{ marginBottom: 16 }} /> : null}

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
              { value: 'position', label: t('courses.sortByPosition') },
              { value: 'code', label: t('courses.sortByCode') },
              { value: 'createdAt', label: t('courses.sortNewest') },
            ]}
            style={{ minWidth: 150 }}
          />
          <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('courses.refresh')} />
        </Flex>

        {canManage ? (
          <Typography.Paragraph type="secondary" data-testid="courses-order-note" style={{ marginBottom: 12 }}>
            {reorderable ? t('courses.order.note') : t('courses.order.hint')}
          </Typography.Paragraph>
        ) : null}

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
          // On a phone the table scrolls inside its own box instead of widening the page (KI-095, as KI-094 on
          // /users). `true`, not 'max-content': the table still fills its box whenever it fits (a desktop).
          scroll={{ x: true }}
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

      <CourseDrawer
        courseId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdated={list.replaceItem}
        onDeleted={list.removeItem}
      />

      <CreateCourseModal
        open={creating}
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
