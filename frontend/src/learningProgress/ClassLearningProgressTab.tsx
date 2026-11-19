// The «تقدّم التعلّم» tab of the class drawer (MOD-20, roadmap §4q — D-R137), on
// API-235: one row per active or completed enrollment of the class, in
// enrollment order, with the student (the caller's projection), their progress
// in the course's required published lessons, their last activity and last
// lesson. Read-only; every number is the server's (D-R133). The drawer shows the
// tab to whoever may read the roster (`canReadRoster()` — `enrollments.read`
// plus `enrollments.manage` or teaching the class); the server stays the
// boundary (404 class_not_found otherwise).
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Empty, Flex, Progress, Skeleton, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import type { AcademyClass } from '../api/classes'
import { getClassLearningProgress } from '../api/learningProgress'
import type { ClassLearningProgress, ClassLearningStudent } from '../api/learningProgress'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, formatDateTime, localizedLabel } from '../users/users.format'

type LoadFailure = 'not_available' | 'error'

interface ClassLearningProgressTabProps {
  cls: Pick<AcademyClass, 'id'>
}

/** Sorts by the server's percent; a student without a required lesson to count (null) comes first in ascending order. */
function byProgress(a: ClassLearningStudent, b: ClassLearningStudent): number {
  return (a.progress.percent ?? -1) - (b.progress.percent ?? -1) || a.progress.completedRequired - b.progress.completedRequired
}

export function ClassLearningProgressTab({ cls }: ClassLearningProgressTabProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [data, setData] = useState<ClassLearningProgress | null>(null)
  const [failure, setFailure] = useState<LoadFailure | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    getClassLearningProgress(cls.id, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setData(loaded)
        setFailure(null)
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setFailure(error instanceof ApiError && error.status === 404 ? 'not_available' : 'error')
        setLoading(false)
      })
    return () => controller.abort()
  }, [cls.id, reloadTick])

  const reload = useCallback(() => {
    setLoading(true)
    setReloadTick((tick) => tick + 1)
  }, [])

  if (failure === 'not_available') return <Alert type="info" showIcon title={t('learningProgress.notAvailable')} />
  if (failure === 'error' && !data) {
    return (
      <Alert
        type="error"
        showIcon
        title={t('learningProgress.loadError')}
        action={
          <Button size="small" onClick={reload}>
            {t('learningProgress.retry')}
          </Button>
        }
      />
    )
  }
  if (!data) return <Skeleton active paragraph={{ rows: 4 }} data-testid="learning-progress-loading" />

  const columns: TableProps<ClassLearningStudent>['columns'] = [
    {
      title: t('learningProgress.columns.student'),
      key: 'student',
      render: (_, row) => (
        <Space size={4} wrap>
          <Typography.Text strong={row.student.deletedAt === null} delete={row.student.deletedAt !== null}>
            {displayNameOf(row.student)}
          </Typography.Text>
          {row.student.deletedAt !== null ? <Tag>{t('learningProgress.deletedAccount')}</Tag> : null}
        </Space>
      ),
    },
    {
      title: t('learningProgress.columns.status'),
      key: 'status',
      render: (_, row) => <StatusTag value={row.enrollmentStatus} />,
    },
    {
      title: t('learningProgress.columns.progress'),
      key: 'progress',
      sorter: byProgress,
      sortDirections: ['descend', 'ascend'],
      render: (_, row) =>
        row.progress.percent === null ? (
          <Typography.Text type="secondary">{t('learningProgress.noRequired')}</Typography.Text>
        ) : (
          <Flex vertical gap={0} style={{ minWidth: 140 }}>
            <Progress percent={row.progress.percent} size="small" status={row.progress.isComplete ? 'success' : 'normal'} />
            <Space size={4} wrap>
              <Typography.Text type="secondary">
                {t('learningProgress.ofTotal', { completed: row.progress.completedRequired, total: row.progress.required })}
              </Typography.Text>
              {row.progress.isComplete ? <Tag color="green">{t('learningProgress.complete')}</Tag> : null}
            </Space>
          </Flex>
        ),
    },
    {
      title: t('learningProgress.columns.lastActivity'),
      key: 'lastActivity',
      render: (_, row) =>
        row.lastActivityAt ? formatDateTime(row.lastActivityAt, language) : <Typography.Text type="secondary">{t('learningProgress.never')}</Typography.Text>,
    },
    {
      title: t('learningProgress.columns.lastLesson'),
      key: 'lastLesson',
      render: (_, row) => (row.lastLesson ? localizedLabel(row.lastLesson.title, language) : '—'),
    },
  ]

  return (
    <Flex vertical gap={12} data-testid="class-learning-progress">
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Space orientation="vertical" size={0}>
          <Typography.Text>
            {localizedLabel(data.course.name, language)} (<bdi dir="ltr">{data.course.code}</bdi>)
          </Typography.Text>
          <Typography.Text type="secondary">{t('learningProgress.summary', { lessons: data.totals.lessons, required: data.totals.required })}</Typography.Text>
        </Space>
        <Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>
          {t('learningProgress.refresh')}
        </Button>
      </Flex>
      <Typography.Text type="secondary">{t('learningProgress.intro')}</Typography.Text>
      {failure === 'error' ? <Alert type="error" showIcon title={t('learningProgress.loadError')} /> : null}
      {data.students.length === 0 ? (
        <Empty description={t('learningProgress.empty')} />
      ) : (
        <Table<ClassLearningStudent> rowKey="enrollmentId" columns={columns} dataSource={data.students} pagination={false} size="small" scroll={{ x: true }} />
      )}
    </Flex>
  )
}
