// Detail drawer of one course (MOD-04-T05): reads GET /api/courses/:id
// (API-043); for holders of `courses.manage` an edit form (smallest PATCH —
// API-045) and an actions menu built from the mirrored state machine
// (courses.status.ts → API-046, and API-047 for a draft), each action
// confirmed in a modal. Everyone else sees the published course read-only.
import { DeleteOutlined, DownOutlined, EditOutlined, InboxOutlined, RocketOutlined, StopOutlined, UndoOutlined } from '@ant-design/icons'
import { Alert, App, Button, Descriptions, Drawer, Dropdown, Flex, Form, Modal, Skeleton, Space, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { changeCourseStatus, deleteCourse, getCourse, updateCourse } from '../api/courses'
import type { Course } from '../api/courses'
import type { Level } from '../api/levels'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime, localizedLabel } from '../users/users.format'
import { CourseFormFields } from './CourseFormFields'
import { describeCoursesFailure, failureMessage } from './courses.errors'
import { courseFormValuesOf, planCoursePatch } from './courses.form'
import type { CourseFormValues } from './courses.form'
import { availableCourseActions, isDangerousCourseAction } from './courses.status'
import type { CourseMenuAction } from './courses.status'

const ICONS: Readonly<Record<CourseMenuAction, ReactNode>> = {
  publish: <RocketOutlined />,
  unpublish: <StopOutlined />,
  archive: <InboxOutlined />,
  restore: <UndoOutlined />,
  delete: <DeleteOutlined />,
}

const DASH = '—'

interface CourseDrawerProps {
  courseId: string | null
  levels: Level[]
  onClose: () => void
  /** The course the server returned after an edit or a status change. */
  onUpdated: (course: Course) => void
  /** A draft was deleted. */
  onDeleted: (courseId: string) => void
}

export function CourseDrawer({ courseId, levels, onClose, onUpdated, onDeleted }: CourseDrawerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('courses.manage')
  const [course, setCourse] = useState<Course | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<CourseMenuAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()

  useEffect(() => {
    if (!courseId) return
    const controller = new AbortController()
    getCourse(courseId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setCourse(loaded)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(failureMessage(t, describeCoursesFailure(error)))
      })
    return () => controller.abort()
  }, [courseId, reloadTick, t])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  const close = () => {
    setCourse(null)
    setLoadError(null)
    setEditing(false)
    setPending(null)
    setActionError(null)
    onClose()
  }

  const applyUpdate = (updated: Course) => {
    setCourse(updated)
    onUpdated(updated)
  }

  const save = async (values: CourseFormValues) => {
    if (!course) return
    const body = planCoursePatch(course, values)
    if (!body) {
      message.info(t('courses.drawer.nothingChanged'))
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      applyUpdate(await updateCourse(course.id, body))
      setEditing(false)
      message.success(t('courses.drawer.saved'))
    } catch (caught) {
      const failure = describeCoursesFailure(caught)
      const text = failureMessage(t, failure)
      if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
      else message.error(text)
    } finally {
      setSaving(false)
    }
  }

  const confirmAction = async () => {
    if (!course || !pending) return
    setBusy(true)
    setActionError(null)
    try {
      if (pending === 'delete') {
        await deleteCourse(course.id)
        message.success(t('courses.done.delete'))
        setPending(null)
        onDeleted(course.id)
        close()
        return
      }
      applyUpdate(await changeCourseStatus(course.id, pending))
      message.success(t(`courses.done.${pending}`))
      setPending(null)
    } catch (caught) {
      const failure = describeCoursesFailure(caught)
      setActionError(failureMessage(t, failure))
      // Changed elsewhere meanwhile: show the course as the server holds it now.
      if (failure.key.endsWith('invalid_transition') || failure.key.endsWith('course_not_deletable')) reload()
    } finally {
      setBusy(false)
    }
  }

  const actions = course && !editing ? availableCourseActions(course.status, canManage) : []
  const menu: MenuProps['items'] = actions.map((action) => ({
    key: action,
    label: t(`courses.actions.${action}`),
    icon: ICONS[action],
    danger: isDangerousCourseAction(action),
  }))

  const name = course ? localizedLabel(course.name, language) : t('courses.drawer.title')
  const optional = (value: string | number | null | undefined, render?: (value: string | number) => string) =>
    value === null || value === undefined || value === '' ? DASH : render ? render(value) : String(value)

  return (
    <Drawer
      open={courseId !== null}
      onClose={close}
      title={name}
      size="large"
      destroyOnHidden
      extra={
        canManage && course && !editing ? (
          <Space>
            <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
              {t('common.edit')}
            </Button>
            {menu.length > 0 ? (
              <Dropdown
                trigger={['click']}
                destroyOnHidden
                menu={{
                  items: menu,
                  onClick: ({ key }) => {
                    setActionError(null)
                    setPending(key as CourseMenuAction)
                  },
                }}
              >
                <Button icon={<DownOutlined />} iconPlacement="end">
                  {t('courses.actions.menu')}
                </Button>
              </Dropdown>
            ) : null}
          </Space>
        ) : null
      }
    >
      {loadError ? (
        <Alert
          type="error"
          showIcon
          message={loadError}
          action={
            <Button size="small" onClick={reload}>
              {t('courses.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {!course && !loadError ? <Skeleton active paragraph={{ rows: 8 }} data-testid="course-loading" /> : null}

      {course && editing ? (
        <Form
          // Remount per server version so the form starts from what the server holds.
          key={`${course.id}:${course.updatedAt}`}
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={courseFormValuesOf(course)}
          onFinish={(values) => void save(values as CourseFormValues)}
          disabled={saving}
        >
          <CourseFormFields form={form} levels={levels} />
          <Flex gap={8} justify="flex-end">
            <Button onClick={() => setEditing(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="primary" htmlType="submit" loading={saving}>
              {t('common.save')}
            </Button>
          </Flex>
        </Form>
      ) : null}

      {course && !editing ? (
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label={t('courses.fields.code')}>
            <Typography.Text dir="ltr">{course.code}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label={t('common.status')}>
            <StatusTag value={course.status} />
          </Descriptions.Item>
          <Descriptions.Item label={t('courses.fields.nameAr')}>{course.name.ar}</Descriptions.Item>
          <Descriptions.Item label={t('courses.fields.nameEn')}>{optional(course.name.en)}</Descriptions.Item>
          <Descriptions.Item label={t('courses.fields.level')}>
            {course.level ? `${localizedLabel(course.level.name, language)} (${course.level.code})` : DASH}
          </Descriptions.Item>
          <Descriptions.Item label={t('courses.fields.durationHours')}>{optional(course.durationHours)}</Descriptions.Item>
          <Descriptions.Item label={t('courses.fields.sessionsCount')}>{optional(course.sessionsCount)}</Descriptions.Item>
          <Descriptions.Item label={t('courses.fields.ageRange')}>
            {course.minAge === null && course.maxAge === null ? DASH : `${optional(course.minAge)} – ${optional(course.maxAge)}`}
          </Descriptions.Item>
          <Descriptions.Item label={t('courses.fields.summary')}>{course.summary ? localizedLabel(course.summary, language) : DASH}</Descriptions.Item>
          <Descriptions.Item label={t('courses.fields.description')}>
            {course.description ? localizedLabel(course.description, language) : DASH}
          </Descriptions.Item>
          <Descriptions.Item label={t('courses.fields.createdAt')}>{formatDateTime(course.createdAt, language)}</Descriptions.Item>
          <Descriptions.Item label={t('courses.fields.updatedAt')}>{formatDateTime(course.updatedAt, language)}</Descriptions.Item>
        </Descriptions>
      ) : null}

      <Modal
        open={pending !== null}
        title={pending && course ? t('courses.confirm.title', { action: t(`courses.actions.${pending}`), name }) : ''}
        okText={pending ? t(`courses.actions.${pending}`) : t('common.save')}
        okButtonProps={{ danger: pending ? isDangerousCourseAction(pending) : false }}
        cancelText={t('common.cancel')}
        confirmLoading={busy}
        onOk={() => void confirmAction()}
        onCancel={() => {
          if (!busy) {
            setPending(null)
            setActionError(null)
          }
        }}
        destroyOnHidden
      >
        {pending ? <Typography.Paragraph>{t(`courses.confirm.${pending}`)}</Typography.Paragraph> : null}
        {actionError ? <Alert type="error" showIcon message={actionError} /> : null}
      </Modal>
    </Drawer>
  )
}
