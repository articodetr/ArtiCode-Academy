// «الواجبات» of a class's page (CH-0374): the class's homework (API-102 with `classId`), by due date, each opening
// the assignment drawer (details, edit, status, submissions and grading); «إضافة واجب» adds one to this class.
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Empty, Flex, Skeleton, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listAssignments } from '../api/assignments'
import type { Assignment } from '../api/assignments'
import type { AcademyClass } from '../api/classes'
import { AssignmentDrawer } from '../assignments/AssignmentDrawer'
import { CreateAssignmentModal } from '../assignments/CreateAssignmentModal'
import { assignmentTitle, formatZonedDateTime, submissionsRatio } from '../assignments/assignments.format'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'

const PAGE = 100
const OPEN_FOR_WORK = ['planned', 'open', 'running']

export function ClassAssignmentsTab({ cls }: { cls: AcademyClass }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canAdd = hasPermission('assignments.manage') && OPEN_FOR_WORK.includes(cls.status)
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState<{ key: number; items: Assignment[]; error: unknown }>({ key: -1, items: [], error: null })
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const loading = state.key !== reloadTick

  useEffect(() => {
    const controller = new AbortController()
    listAssignments({ classId: cls.id, order: 'asc', limit: PAGE }, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setState({ key: reloadTick, items: list.items, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key: reloadTick, items: [], error })
      })
    return () => controller.abort()
  }, [cls.id, reloadTick])

  const reload = () => setReloadTick((tick) => tick + 1)

  return (
    <Flex vertical gap={12}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {t('classPage.assignments.title')}
        </Typography.Title>
        <Flex gap={8}>
          <Button icon={<ReloadOutlined />} onClick={reload} aria-label={t('lessons.refresh')} />
          {canAdd ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              {t('assignments.addAssignment')}
            </Button>
          ) : null}
        </Flex>
      </Flex>

      {state.error && !loading ? <Alert type="error" showIcon title={t('classPage.loadError')} /> : null}

      {loading && state.key === -1 ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : state.items.length === 0 && !state.error ? (
        <Empty description={canAdd ? t('classPage.assignments.emptyManage') : t('classPage.assignments.empty')} />
      ) : (
        state.items.map((assignment) => (
          <Card key={assignment.id} hoverable size="small" onClick={() => setOpenId(assignment.id)} data-testid={`class-assignment-${assignment.id}`}>
            <Flex justify="space-between" align="center" wrap gap={10}>
              <Flex vertical gap={2}>
                <Typography.Text strong>
                  <bdi>{assignmentTitle(assignment, language)}</bdi>
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {t('classPage.assignments.due')}{' '}
                  {assignment.dueAt ? (
                    <bdi>{formatZonedDateTime(assignment.dueAt, assignment.timeZone, language)}</bdi>
                  ) : (
                    t('assignments.drawer.noDue')
                  )}
                </Typography.Text>
              </Flex>
              <Flex gap={10} align="center" wrap>
                <Typography.Text style={{ fontSize: 13 }}>
                  {t('classPage.assignments.submitted')} <bdi dir="ltr">{submissionsRatio(assignment)}</bdi>
                </Typography.Text>
                <StatusTag value={assignment.status} />
              </Flex>
            </Flex>
          </Card>
        ))
      )}

      <AssignmentDrawer
        assignmentId={openId}
        onClose={() => setOpenId(null)}
        onUpdated={(updated) => setState((current) => ({ ...current, items: current.items.map((item) => (item.id === updated.id ? updated : item)) }))}
        onDeleted={() => {
          setOpenId(null)
          reload()
        }}
      />
      <CreateAssignmentModal
        open={creating}
        fixed={{ classId: cls.id, place: t('classPage.forClass', { name: localizedLabel(cls.name, language) }) }}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false)
          message.success(t('assignments.create.created', { title: assignmentTitle(created, language) }))
          reload()
          setOpenId(created.id)
        }}
      />
    </Flex>
  )
}
