// PORTAL-04 phase 1: the admin's «فتح الاشتراك» panel in the course drawer. One
// button makes a published course open for subscription through a general class
// (courses.openEnrollment.ts decides what that takes) and another stops it.
// Every write starts from a fresh read and ends with one, and the panel shows
// only what the server returned, so a failure half way leaves a planned general
// class that the next press resumes instead of creating a second one.
import { StopOutlined, UnlockOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Form, Input, InputNumber, Modal, Skeleton, Space, Tag, Typography } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import { ApiError } from '../api/client'
import { changeClassStatus, createClass, updateClass } from '../api/classes'
import type { AcademyClass } from '../api/classes'
import type { Course } from '../api/courses'
import { useAuth } from '../auth/auth-context'
import { describeClassesFailure, failureMessage } from '../classes/classes.errors'
import { CLASS_CAPACITY_MAX } from '../classes/classes.form'
import { isCalendarDate } from '../timetable/timetable.dates'
import {
  DEFAULT_GENERAL_CAPACITY,
  GENERAL_CLASS_NAME,
  GENERAL_CLASS_NOTE,
  coursePriceUnusable,
  defaultStartsOn,
  generalClassCodes,
  hasPrivateClasses,
  isGeneralClass,
  isValidCapacity,
  planEnrollmentPanel,
  planStop,
} from './courses.openEnrollment'
import type { OpenStep } from './courses.openEnrollment'
// Shared with the course drawer's class tabs (one reading of every page).
import { readCourseClasses } from './courseClasses'

type WriteOutcome = 'opened' | 'stopped' | 'stopped_others_open' | 'needs_capacity' | 'codes_exhausted' | 'nothing'

/** What the dialog asks before a new general class is created. */
interface NewClassInput {
  capacity: number
  startsOn: string
}

async function applyReuseStep(step: Exclude<OpenStep, { kind: 'create' }>): Promise<void> {
  if (step.kind === 'reenable') {
    await updateClass(step.classId, { selfEnrollment: true })
    return
  }
  if (step.enableSelfService) await updateClass(step.classId, { selfEnrollment: true })
  await changeClassStatus(step.classId, { action: 'open' })
}

/** Resolves what «فتح الاشتراك» needs on the server's current classes; a taken code moves on to the next candidate. */
async function openCourseEnrollment(course: Course, input: NewClassInput | undefined): Promise<WriteOutcome> {
  for (const code of generalClassCodes(course.code)) {
    const plan = planEnrollmentPanel(course.status, await readCourseClasses(course.id))
    if (plan.kind === 'unpublished') return 'nothing'
    if (plan.kind === 'open') return 'opened'
    if (plan.step.kind !== 'create') {
      await applyReuseStep(plan.step)
      return 'opened'
    }
    if (input === undefined) return 'needs_capacity'
    let created: AcademyClass
    try {
      created = await createClass({
        courseId: course.id,
        code,
        name: { ...GENERAL_CLASS_NAME },
        capacity: input.capacity,
        startsOn: input.startsOn,
        notes: GENERAL_CLASS_NOTE,
        selfEnrollment: true,
      })
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'class_code_taken') continue
      throw caught
    }
    await changeClassStatus(created.id, { action: 'open' })
    return 'opened'
  }
  return 'codes_exhausted'
}

/** Turns off the general classes only; an admin's own self-service class is never changed. */
async function stopCourseEnrollment(courseId: string): Promise<WriteOutcome> {
  const { targets, staysOpenThrough } = planStop(await readCourseClasses(courseId))
  if (targets.length === 0) return 'nothing'
  for (const klass of targets) {
    await updateClass(klass.id, { selfEnrollment: false })
  }
  return staysOpenThrough.length > 0 ? 'stopped_others_open' : 'stopped'
}

interface OpenEnrollmentPanelProps {
  course: Course
}

/** Only for a holder of `classes.manage` who can also list classes (`classes.read`). */
export function OpenEnrollmentPanel({ course }: OpenEnrollmentPanelProps) {
  const { hasPermission } = useAuth()
  if (!hasPermission('classes.manage') || !hasPermission('classes.read')) return null
  return <PanelBody course={course} />
}

function PanelBody({ course }: OpenEnrollmentPanelProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const courseId = course.id
  const [classes, setClasses] = useState<AcademyClass[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [askCapacity, setAskCapacity] = useState(false)
  const [askStop, setAskStop] = useState(false)
  // Set before the first await, so a second click in the same tick cannot start a second write.
  const writing = useRef(false)
  const reading = useRef<AbortController | null>(null)

  // Never rejects: a failed read shows its own alert and hides the actions until a retry succeeds.
  const refresh = useCallback((): Promise<void> => {
    reading.current?.abort()
    const controller = new AbortController()
    reading.current = controller
    return readCourseClasses(courseId, controller.signal).then(
      (items) => {
        if (controller.signal.aborted) return
        setClasses(items)
        setLoadFailed(false)
      },
      () => {
        if (controller.signal.aborted) return
        setClasses(null)
        setLoadFailed(true)
      },
    )
  }, [courseId])

  useEffect(() => {
    void refresh()
    return () => reading.current?.abort()
  }, [refresh])

  const write = async (work: () => Promise<WriteOutcome>): Promise<WriteOutcome> => {
    if (writing.current) return 'nothing'
    writing.current = true
    setBusy(true)
    setWriteError(null)
    let outcome: WriteOutcome = 'nothing'
    try {
      outcome = await work()
    } catch (caught) {
      setWriteError(failureMessage(t, describeClassesFailure(caught)))
    }
    await refresh()
    writing.current = false
    setBusy(false)
    return outcome
  }

  const openEnrollment = async (input?: NewClassInput) => {
    setAskCapacity(false)
    const outcome = await write(() => openCourseEnrollment(course, input))
    if (outcome === 'opened') message.success(t('courseEnrollmentPanel.done.opened'))
    else if (outcome === 'needs_capacity') setAskCapacity(true)
    else if (outcome === 'codes_exhausted') setWriteError(t('courseEnrollmentPanel.errors.codesExhausted'))
  }

  const stopEnrollment = async () => {
    setAskStop(false)
    const outcome = await write(() => stopCourseEnrollment(courseId))
    if (outcome === 'stopped') message.success(t('courseEnrollmentPanel.done.stopped'))
    else if (outcome === 'stopped_others_open') message.success(t('courseEnrollmentPanel.done.stoppedPartial'))
  }

  const plan = classes ? planEnrollmentPanel(course.status, classes) : null
  const stopPlan = classes ? planStop(classes) : null
  const othersStayOpen = (stopPlan?.staysOpenThrough.length ?? 0) > 0

  const pressOpen = () => {
    if (writing.current) return
    if (plan?.kind === 'closed' && plan.step.kind === 'create') setAskCapacity(true)
    else void openEnrollment()
  }

  return (
    <Card size="small" title={t('courseEnrollmentPanel.title')} style={{ marginBottom: 16 }} data-testid="open-enrollment-panel">
      {writeError ? <Alert type="error" showIcon title={writeError} style={{ marginBottom: 12 }} /> : null}

      {loadFailed ? (
        <Alert
          type="error"
          showIcon
          title={t('courseEnrollmentPanel.loadFailed')}
          action={
            <Button size="small" onClick={() => void refresh()}>
              {t('courseEnrollmentPanel.retry')}
            </Button>
          }
        />
      ) : null}

      {!plan && !loadFailed ? <Skeleton active title={false} paragraph={{ rows: 2 }} /> : null}

      {plan?.kind === 'unpublished' ? (
        <Flex vertical gap={8} align="flex-start">
          <Typography.Text type="secondary">{t('courseEnrollmentPanel.unpublished')}</Typography.Text>
          <Button icon={<UnlockOutlined />} disabled>
            {t('courseEnrollmentPanel.actions.open')}
          </Button>
        </Flex>
      ) : null}

      {plan?.kind === 'open' ? (
        <Flex vertical gap={8} align="flex-start">
          <Tag color="green">{t('courseEnrollmentPanel.openState')}</Tag>
          <Typography.Text>{t('courseEnrollmentPanel.openHint')}</Typography.Text>
          {plan.classes.map((klass) => (
            <Space key={klass.id} size={8} wrap>
              <Typography.Text strong>
                <bdi dir="ltr">{klass.code}</bdi>
              </Typography.Text>
              <Typography.Text type="secondary">
                {t('courseEnrollmentPanel.seats')} <bdi dir="ltr">{`${klass.enrolledCount} / ${klass.capacity}`}</bdi>
              </Typography.Text>
              {isGeneralClass(klass) ? null : <Tag>{t('courseEnrollmentPanel.privateClass')}</Tag>}
            </Space>
          ))}
          {othersStayOpen ? <Typography.Text type="secondary">{t('courseEnrollmentPanel.privateHint')}</Typography.Text> : null}
          {stopPlan && stopPlan.targets.length > 0 ? (
            <Button danger icon={<StopOutlined />} loading={busy} onClick={() => setAskStop(true)}>
              {t('courseEnrollmentPanel.actions.stop')}
            </Button>
          ) : null}
        </Flex>
      ) : null}

      {plan?.kind === 'closed' ? (
        <Flex vertical gap={8} align="flex-start">
          <Tag>{t('courseEnrollmentPanel.closedState')}</Tag>
          <Typography.Text type="secondary">{t('courseEnrollmentPanel.closedHint')}</Typography.Text>
          <Button type="primary" icon={<UnlockOutlined />} loading={busy} onClick={pressOpen}>
            {t('courseEnrollmentPanel.actions.open')}
          </Button>
        </Flex>
      ) : null}

      {plan && plan.kind !== 'unpublished' && coursePriceUnusable(course) ? (
        <Alert type="warning" showIcon title={t('courseEnrollmentPanel.priceWarning')} style={{ marginTop: 12 }} />
      ) : null}

      <Modal open={askCapacity} title={t('courseEnrollmentPanel.create.title')} footer={null} onCancel={() => setAskCapacity(false)} destroyOnHidden>
        {askCapacity ? (
          <NewClassDialogBody
            hasOtherClasses={classes !== null && hasPrivateClasses(classes)}
            onSubmit={(input) => void openEnrollment(input)}
            onCancel={() => setAskCapacity(false)}
          />
        ) : null}
      </Modal>

      <Modal
        open={askStop}
        title={t(othersStayOpen ? 'courseEnrollmentPanel.stop.titlePartial' : 'courseEnrollmentPanel.stop.title')}
        okText={t('courseEnrollmentPanel.actions.stop')}
        okButtonProps={{ danger: true }}
        cancelText={t('common.cancel')}
        onOk={() => void stopEnrollment()}
        onCancel={() => setAskStop(false)}
        destroyOnHidden
      >
        <Typography.Paragraph>{t(othersStayOpen ? 'courseEnrollmentPanel.stop.contentPartial' : 'courseEnrollmentPanel.stop.content')}</Typography.Paragraph>
      </Modal>
    </Card>
  )
}

interface NewClassFormProps {
  /** The course has classes of the admin's that this button leaves alone. */
  hasOtherClasses: boolean
  onSubmit: (input: NewClassInput) => void
  onCancel: () => void
}

/** Waits for the shared academy reading, so the form's first value is already the academy's «today». */
function NewClassDialogBody({ hasOtherClasses, onSubmit, onCancel }: NewClassFormProps) {
  const { academy, error } = useAcademy()
  if (academy === null && error === null) return <Skeleton active title={false} paragraph={{ rows: 3 }} />
  return <CapacityForm hasOtherClasses={hasOtherClasses} initialStartsOn={defaultStartsOn(academy)} onSubmit={onSubmit} onCancel={onCancel} />
}

/** The capacity and start day of the new class; mounted per dialog session so it owns its form (KI-049). */
function CapacityForm({ hasOtherClasses, initialStartsOn, onSubmit, onCancel }: NewClassFormProps & { initialStartsOn: string }) {
  const { t } = useTranslation()
  const [form] = Form.useForm<NewClassInput>()
  const invalid = t('courseEnrollmentPanel.create.capacityInvalid', { max: CLASS_CAPACITY_MAX })
  const invalidDay = t('courseEnrollmentPanel.create.startsOnInvalid')

  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={{ capacity: DEFAULT_GENERAL_CAPACITY, startsOn: initialStartsOn }}
      onFinish={(values) => onSubmit({ capacity: values.capacity, startsOn: values.startsOn })}
    >
      <Typography.Paragraph>{t('courseEnrollmentPanel.create.intro')}</Typography.Paragraph>
      {hasOtherClasses ? (
        <Alert
          type="info"
          showIcon
          title={t('courseEnrollmentPanel.create.otherClasses', { option: t('classes.fields.selfEnrollment') })}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form.Item
        name="capacity"
        label={t('courseEnrollmentPanel.create.capacity')}
        extra={t('courseEnrollmentPanel.create.capacityHint')}
        rules={[{ validator: (_, value: unknown) => (isValidCapacity(value) ? Promise.resolve() : Promise.reject(new Error(invalid))) }]}
      >
        <InputNumber min={1} max={CLASS_CAPACITY_MAX} precision={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item
        name="startsOn"
        label={t('courseEnrollmentPanel.create.startsOn')}
        extra={t('courseEnrollmentPanel.create.startsOnHint')}
        rules={[{ validator: (_, value: unknown) => (isCalendarDate(value) ? Promise.resolve() : Promise.reject(new Error(invalidDay))) }]}
      >
        <Input type="date" dir="ltr" />
      </Form.Item>
      <Flex gap={8} justify="flex-end">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="primary" htmlType="submit">
          {t('courseEnrollmentPanel.actions.open')}
        </Button>
      </Flex>
    </Form>
  )
}
