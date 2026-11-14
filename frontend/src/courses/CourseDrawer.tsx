// Detail drawer of one course (MOD-04-T05/T06): reads GET /api/courses/:id
// (API-043) and shows two tabs — details and syllabus (SyllabusTab, T06).
// For holders of `courses.manage`: an edit form (smallest PATCH — API-045) and
// an actions menu built from the mirrored state machine (courses.status.ts →
// API-046, and API-047 for a draft), each action confirmed in a modal.
// Everyone else sees the published course read-only.
// Since J-F23 (KI-054, the rule of the class drawer's KI-052 after J-F21):
// while the edit form or the syllabus editor holds unsaved work, Escape and a
// mask click no longer close the drawer, and the close button asks first; an
// editor opened without a change, or changed back, holds nothing.
// Since J-F27 the same unsaved work also holds a browser back/forward, which
// asks the same question (NavigationBlocker), and a reload or a tab close gets
// the browser's own prompt (useUnsavedChangesGuard — KI-055).
import { DeleteOutlined, DownOutlined, EditOutlined, InboxOutlined, RocketOutlined, StopOutlined, UndoOutlined } from '@ant-design/icons'
import { Alert, App, Button, Descriptions, Drawer, Dropdown, Flex, Form, Modal, Skeleton, Space, Tabs, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { changeCourseStatus, deleteCourse, getCourse, updateCourse } from '../api/courses'
import type { Course } from '../api/courses'
import type { Level } from '../api/levels'
import { useAuth } from '../auth/auth-context'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { dockedDrawerProps } from '../common/useDockedPanel'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime, localizedLabel } from '../users/users.format'
import { CourseFormFields } from './CourseFormFields'
import { describeCoursesFailure, failureMessage } from './courses.errors'
import { courseFormHasChanges, courseFormValuesOf, planCoursePatch } from './courses.form'
import type { CourseFormValues } from './courses.form'
import { availableCourseActions, isDangerousCourseAction } from './courses.status'
import type { CourseMenuAction } from './courses.status'
import { SyllabusTab } from './SyllabusTab'

const ICONS: Readonly<Record<CourseMenuAction, ReactNode>> = {
  publish: <RocketOutlined />,
  unpublish: <StopOutlined />,
  archive: <InboxOutlined />,
  restore: <UndoOutlined />,
  delete: <DeleteOutlined />,
}

const DASH = '—'

type DrawerTab = 'details' | 'syllabus'

/** The editors of the drawer that report unsaved work (KI-054): the edit form and the syllabus editor. */
const NOTHING_UNSAVED: Readonly<Record<DrawerTab, boolean>> = { details: false, syllabus: false }

interface CourseDrawerProps {
  courseId: string | null
  levels: Level[]
  onClose: () => void
  /** The course the server returned after an edit or a status change. */
  onUpdated: (course: Course) => void
  /** A draft was deleted. */
  onDeleted: (courseId: string) => void
  /**
   * Redesign (2026-11-14): the element of a side panel beside the list to open in, instead of over the page —
   * no mask, the full width and height of the panel. Absent (phones, tests) = the usual overlay drawer.
   */
  dockedIn?: HTMLElement | null
  /** Told whenever the drawer starts or stops holding unsaved work, so the list can ask before switching course. */
  onUnsavedChange?: (unsaved: boolean) => void
}

export function CourseDrawer({ courseId, levels, onClose, onUpdated, onDeleted, dockedIn, onUnsavedChange }: CourseDrawerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('courses.manage')
  const [course, setCourse] = useState<Course | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [tab, setTab] = useState<DrawerTab>('details')
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<CourseMenuAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [unsavedParts, setUnsavedParts] = useState<Readonly<Record<DrawerTab, boolean>>>(NOTHING_UNSAVED)

  // One stable reporter per editor (the editors report from an effect that depends on it).
  const reportUnsaved = useMemo(() => {
    const reporter = (part: DrawerTab) => (unsaved: boolean) => setUnsavedParts((current) => (current[part] === unsaved ? current : { ...current, [part]: unsaved }))
    return { details: reporter('details'), syllabus: reporter('syllabus') }
  }, [])
  // KI-054: while an editor holds unsaved work, Escape and a mask click must not drop it with the drawer.
  const unsaved = (editing && unsavedParts.details) || unsavedParts.syllabus

  // The list asks before it switches to another course while this one holds unsaved work (docked panel).
  useEffect(() => {
    onUnsavedChange?.(unsaved)
  }, [unsaved, onUnsavedChange])

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
    setTab('details')
    setEditing(false)
    setPending(null)
    setActionError(null)
    setUnsavedParts(NOTHING_UNSAVED)
    onClose()
  }

  // The close button (Escape and the mask too when nothing is unsaved) asks first while an editor
  // holds unsaved work, and so does a browser back/forward (NavigationBlocker below) — one question
  // (common.unsaved.*); a reload or a tab close gets the browser's own prompt (KI-055).
  const { requestClose, holdNavigation } = useUnsavedChangesGuard(unsaved, close)

  const applyUpdate = (updated: Course) => {
    setCourse(updated)
    onUpdated(updated)
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
  const optional = (value: string | number | null | undefined) => (value === null || value === undefined || value === '' ? DASH : String(value))

  const details = course ? (
    editing ? (
      <CourseEditForm
        // Remount per server version so the form starts from what the server holds.
        key={`${course.id}:${course.updatedAt}`}
        course={course}
        levels={levels}
        onSaved={(updated) => {
          applyUpdate(updated)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
        onUnsavedChange={reportUnsaved.details}
      />
    ) : (
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
    )
  ) : null

  return (
    <Drawer
      open={courseId !== null}
      onClose={requestClose}
      // KI-054: unsaved work turns off the Escape key and the mask click; an open
      // Select or Dropdown still closes on Escape (it sits on top of the drawer).
      keyboard={!unsaved}
      {...dockedDrawerProps(dockedIn, unsaved, 'large')}
      title={name}
      destroyOnHidden
      extra={
        canManage && course && !editing ? (
          <Space>
            {tab === 'details' ? (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            ) : null}
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
      <NavigationBlocker when={unsaved} onBlocked={holdNavigation} />
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

      {course ? (
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as DrawerTab)}
          items={[
            { key: 'details', label: t('courses.drawer.tabs.details'), children: details },
            { key: 'syllabus', label: t('courses.drawer.tabs.syllabus'), children: <SyllabusTab courseId={course.id} canManage={canManage} onUnsavedChange={reportUnsaved.syllabus} />, disabled: editing },
          ]}
        />
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

interface CourseEditFormProps {
  course: Course
  levels: Level[]
  onSaved: (course: Course) => void
  onCancel: () => void
  /** Whether a field holds a change (KI-054): reported on every edit, false once the form is left. */
  onUnsavedChange: (unsaved: boolean) => void
}

/**
 * The edit form of one edit session. It owns its form so every session starts
 * from the course as the server holds it: a form instance kept across
 * sessions would merge the values typed in a cancelled session over the new
 * initial values (rc-field-form keeps unmounted values — CH-0049).
 */
function CourseEditForm({ course, levels, onSaved, onCancel, onUnsavedChange }: CourseEditFormProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  useEffect(() => () => onUnsavedChange(false), [onUnsavedChange])

  const save = async (values: CourseFormValues) => {
    const body = planCoursePatch(course, values)
    if (!body) {
      message.info(t('courses.drawer.nothingChanged'))
      onCancel()
      return
    }
    setSaving(true)
    try {
      const updated = await updateCourse(course.id, body)
      message.success(t('courses.drawer.saved'))
      onSaved(updated)
    } catch (caught) {
      const failure = describeCoursesFailure(caught)
      const text = failureMessage(t, failure)
      if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
      else message.error(text)
      setSaving(false)
    }
  }

  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={courseFormValuesOf(course)}
      // A change changed back holds nothing (KI-054 — the J-F21 rule): compared with the stored course.
      onValuesChange={(_changed, values) => onUnsavedChange(courseFormHasChanges(course, values as CourseFormValues))}
      onFinish={(values) => void save(values as CourseFormValues)}
      disabled={saving}
    >
      <CourseFormFields form={form} levels={levels} />
      <Flex gap={8} justify="flex-end">
        <Button onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="primary" htmlType="submit" loading={saving}>
          {t('common.save')}
        </Button>
      </Flex>
    </Form>
  )
}
