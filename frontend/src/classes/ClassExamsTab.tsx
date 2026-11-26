// «الاختبارات» of a class's page (CH-0374): the class's exams (API-113 with `classId`), by date, each opening the
// exam drawer (details, edit, status, questions, attempts, results); «إضافة اختبار» adds one to this class.
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Empty, Flex, Skeleton, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'
import { listExams } from '../api/exams'
import type { Exam } from '../api/exams'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { CreateExamModal } from '../exams/CreateExamModal'
import { ExamDrawer } from '../exams/ExamDrawer'
import { examTitle, resultsRatio } from '../exams/exams.format'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'

const PAGE = 100
const OPEN_FOR_WORK = ['planned', 'open', 'running']

export function ClassExamsTab({ cls }: { cls: AcademyClass }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canAdd = hasPermission('exams.manage') && OPEN_FOR_WORK.includes(cls.status)
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState<{ key: number; items: Exam[]; error: unknown }>({ key: -1, items: [], error: null })
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const loading = state.key !== reloadTick

  useEffect(() => {
    const controller = new AbortController()
    listExams({ classId: cls.id, order: 'asc', limit: PAGE }, controller.signal)
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
          {t('classPage.exams.title')}
        </Typography.Title>
        <Flex gap={8}>
          <Button icon={<ReloadOutlined />} onClick={reload} aria-label={t('lessons.refresh')} />
          {canAdd ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              {t('exams.addExam')}
            </Button>
          ) : null}
        </Flex>
      </Flex>

      {state.error && !loading ? <Alert type="error" showIcon title={t('classPage.loadError')} /> : null}

      {loading && state.key === -1 ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : state.items.length === 0 && !state.error ? (
        <Empty description={canAdd ? t('classPage.exams.emptyManage') : t('classPage.exams.empty')} />
      ) : (
        state.items.map((exam) => (
          <Card key={exam.id} hoverable size="small" onClick={() => setOpenId(exam.id)} data-testid={`class-exam-${exam.id}`}>
            <Flex justify="space-between" align="center" wrap gap={10}>
              <Flex vertical gap={2}>
                <Flex gap={8} align="center" wrap>
                  <Typography.Text strong>
                    <bdi>{examTitle(exam, language)}</bdi>
                  </Typography.Text>
                  <Tag>{t(`exams.types.${exam.type}`)}</Tag>
                </Flex>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {exam.scheduledAt ? <bdi>{formatZonedDateTime(exam.scheduledAt, exam.timeZone, language)}</bdi> : t('exams.drawer.noDate')}
                </Typography.Text>
              </Flex>
              <Flex gap={10} align="center" wrap>
                <Typography.Text style={{ fontSize: 13 }}>
                  {t('classPage.exams.results')} <bdi dir="ltr">{resultsRatio(exam)}</bdi>
                </Typography.Text>
                <StatusTag value={exam.status} />
              </Flex>
            </Flex>
          </Card>
        ))
      )}

      <ExamDrawer
        examId={openId}
        onClose={() => setOpenId(null)}
        onUpdated={(updated) => setState((current) => ({ ...current, items: current.items.map((item) => (item.id === updated.id ? updated : item)) }))}
        onDeleted={() => {
          setOpenId(null)
          reload()
        }}
      />
      <CreateExamModal
        open={creating}
        fixed={{ classId: cls.id, place: t('classPage.forClass', { name: localizedLabel(cls.name, language) }) }}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false)
          message.success(t('exams.create.created', { title: examTitle(created, language) }))
          reload()
          setOpenId(created.id)
        }}
      />
    </Flex>
  )
}
