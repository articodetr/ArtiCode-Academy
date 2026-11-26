// Detail drawer of one course (MOD-04-T05/T06): reads GET /api/courses/:id
// (API-043) and shows two tabs — details and, since MOD-20, the curriculum
// (CurriculumTab on API-226..228: levels, their lessons and each lesson's
// content; it replaced the flat syllabus tab of T06).
// For holders of `courses.manage`: an edit form (smallest PATCH — API-045) and
// an actions menu built from the mirrored state machine (courses.status.ts →
// API-046, and API-047 for a draft), each action confirmed in a modal.
// Everyone else sees the published course read-only.
// Since J-F23 (KI-054, the rule of the class drawer's KI-052 after J-F21):
// while the edit form or the curriculum editor holds unsaved work, Escape and a
// mask click no longer close the drawer, and the close button asks first; an
// editor opened without a change, or changed back, holds nothing.
// Since J-F27 the same unsaved work also holds a browser back/forward, which
// asks the same question (NavigationBlocker), and a reload or a tab close gets
// the browser's own prompt (useUnsavedChangesGuard — KI-055).
// MOD-19 (D-R122/D-R129): the details show the cover and the price (free, or
// the fee plan's total in the academy currency); the edit form takes the cover
// URL, and — for holders of `fee_plans.manage` only, as the server requires —
// the course type and its fee plan (CoursePricingFields).
// PORTAL-04: the age range is no longer shown or edited (the stored values stay — the
// PATCH never names them). PORTAL-04-COURSE-ORDER: the edit form no longer picks a
// school subject; a stored subject shows in the details like the level.
// The simplified course form: the edit form asks what the create modal asks (Arabic
// name, summary and description, cover, price) plus the course's materials;
// the code, the English texts, the level, the hours and the sessions stay stored and
// are shown in the details when they hold a value (an empty row is not shown).
import { DeleteOutlined, DownOutlined, EditOutlined, InboxOutlined, RocketOutlined, StopOutlined, UndoOutlined } from '@ant-design/icons'
import { Alert, App, Button, Descriptions, Drawer, Dropdown, Flex, Form, Modal, Skeleton, Space, Tabs, Tag, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { changeCourseStatus, deleteCourse, getCourse, updateCourse } from '../api/courses'
import type { Course } from '../api/courses'
import { useAuth } from '../auth/auth-context'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { StatusTag } from '../components/StatusTag'
import { CurriculumTab } from '../curriculum/CurriculumTab'
import { useLocalized } from '../i18n/useLocalized'
import { formatMoney } from '../payments/payments.format'
import { formatDateTime, localizedLabel } from '../users/users.format'
import { CourseFormFields } from './CourseFormFields'
import { CoursePricingFields } from './CoursePricingFields'
import { OpenEnrollmentPanel } from './OpenEnrollmentPanel'
import { CourseClassTabPane } from './CourseClassTabPane'
import { COURSE_CLASS_TAB_LABELS, isCourseClassTab, visibleCourseClassTabs } from './courses.classScope'
import type { CourseClassTab } from './courses.classScope'
import { useCourseClass } from './useCourseClass'
import { describeCoursesFailure, failureMessage } from './courses.errors'
import { courseFormField, courseFormHasChanges, courseFormValuesOf, planCoursePatch } from './courses.form'
import { CourseResourcesField } from './CourseResourcesField'
import type { CourseFormValues } from './courses.form'
import { availableCourseActions, isDangerousCourseAction } from './courses.status'
import type { CourseMenuAction } from './courses.status'
import './courseDrawer.css'

const ICONS: Readonly<Record<CourseMenuAction, ReactNode>> = {
  publish: <RocketOutlined />,
  unpublish: <StopOutlined />,
  archive: <InboxOutlined />,
  restore: <UndoOutlined />,
  delete: <DeleteOutlined />,
}

const DASH = '—'

// The class tabs work on the course's class (the teachers, the students, … of the former class drawer).
type DrawerTab = 'details' | 'curriculum' | CourseClassTab

/**
 * The editors of the drawer that report unsaved work (KI-054): the edit form, the curriculum editor, and
 * the class tabs' teachers editor, enroll form and weekly schedule editor.
 */
type EditorPart = 'details' | 'curriculum' | 'teachers' | 'students' | 'schedule'

const NOTHING_UNSAVED: Readonly<Record<EditorPart, boolean>> = { details: false, curriculum: false, teachers: false, students: false, schedule: false }

interface CourseDrawerProps {
  courseId: string | null
  onClose: () => void
  /** The course the server returned after an edit or a status change. */
  onUpdated: (course: Course) => void
  /** A draft was deleted. */
  onDeleted: (courseId: string) => void
}

export function CourseDrawer({ courseId, onClose, onUpdated, onDeleted }: CourseDrawerProps) {
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
  const [unsavedParts, setUnsavedParts] = useState<Readonly<Record<EditorPart, boolean>>>(NOTHING_UNSAVED)

  // One stable reporter per editor (the editors report from an effect that depends on it).
  const reportUnsaved = useMemo(() => {
    const reporter = (part: EditorPart) => (unsaved: boolean) => setUnsavedParts((current) => (current[part] === unsaved ? current : { ...current, [part]: unsaved }))
    return { details: reporter('details'), curriculum: reporter('curriculum'), teachers: reporter('teachers'), students: reporter('students'), schedule: reporter('schedule') }
  }, [])
  // The class tabs' editors: their class selector waits while they hold work.
  const classUnsaved = unsavedParts.teachers || unsavedParts.students || unsavedParts.schedule
  // KI-054: while an editor holds unsaved work, Escape and a mask click must not drop it with the drawer.
  const unsaved = (editing && unsavedParts.details) || unsavedParts.curriculum || classUnsaved
  // The course's class behind the class tabs: only for classes.read (API-050 needs it), read when a class tab opens.
  const classScope = useCourseClass(hasPermission('classes.read') ? courseId : null)
  // Moved when the details tab opens after a class tab: the «فتح الاشتراك» panel then reads the classes afresh
  // (a class prepared or a student enrolled there changes what it shows).
  const [panelVisit, setPanelVisit] = useState(0)

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

  const details = course ? (
    editing ? (
      <CourseEditForm
        // Remount per server version so the form starts from what the server holds.
        key={`${course.id}:${course.updatedAt}`}
        course={course}
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
          <Typography.Text><bdi dir="ltr">{course.code}</bdi></Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label={t('common.status')}>
          <StatusTag value={course.status} />
        </Descriptions.Item>
        <Descriptions.Item label={t('courses.fields.name')}>{course.name.ar}</Descriptions.Item>
        {/* The form no longer asks the English name, the level, the hours or the sessions: a stored value stays
            visible as data, an empty row is not shown. */}
        {course.name.en ? <Descriptions.Item label={t('courses.fields.nameEn')}>{course.name.en}</Descriptions.Item> : null}
        {course.subject ? (
          <Descriptions.Item label={t('courses.fields.subject')}>{`${localizedLabel(course.subject.name, language)} (${course.subject.code})`}</Descriptions.Item>
        ) : null}
        {course.level ? (
          <Descriptions.Item label={t('courses.fields.level')}>{`${localizedLabel(course.level.name, language)} (${course.level.code})`}</Descriptions.Item>
        ) : null}
        {typeof course.durationHours === 'number' ? <Descriptions.Item label={t('courses.fields.durationHours')}>{course.durationHours}</Descriptions.Item> : null}
        {typeof course.sessionsCount === 'number' ? <Descriptions.Item label={t('courses.fields.sessionsCount')}>{course.sessionsCount}</Descriptions.Item> : null}
        <Descriptions.Item label={t('courses.fields.pricing')}>
          {course.enrollmentFeePlan ? (
            <Space direction="vertical" size={2}>
              <Space size={4} wrap>
                <Tag color="gold">{t('courses.pricing.paid')}</Tag>
                <span>{localizedLabel(course.enrollmentFeePlan.name, language)}</span>
                <bdi dir="ltr">{formatMoney(course.enrollmentFeePlan.total, course.enrollmentFeePlan.currency, language)}</bdi>
              </Space>
              <Typography.Text type="secondary">{t('courses.pricing.installments', { installments: course.enrollmentFeePlan.installments })}</Typography.Text>
              {course.enrollmentFeePlan.isActive ? null : <Alert type="warning" showIcon title={t('courses.pricing.planInactive')} />}
            </Space>
          ) : (
            <Tag color="green">{t('courses.pricing.free')}</Tag>
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('courses.fields.coverImageUrl')}>
          {course.coverImageUrl ? (
            <Typography.Text style={{ wordBreak: 'break-all' }}>
              <bdi dir="ltr">{course.coverImageUrl}</bdi>
            </Typography.Text>
          ) : (
            DASH
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('courses.fields.resources')}>
          {(course.resources ?? []).length > 0 ? (
            <Space orientation="vertical" size={2}>
              {(course.resources ?? []).map((resource, index) => (
                <Typography.Link key={`${index}:${resource.url}`} href={resource.url} target="_blank" rel="noopener noreferrer">
                  {localizedLabel(resource.title, language)}
                </Typography.Link>
              ))}
            </Space>
          ) : (
            DASH
          )}
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
      mask={{ closable: !unsaved }}
      title={name}
      rootClassName="course-drawer"
      size="large"
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
          onChange={(key) => {
            // Entering the class tabs from another tab reads the course's classes again: the «فتح الاشتراك»
            // panel of the details tab may have just created or changed the general class.
            if (isCourseClassTab(key) && !isCourseClassTab(tab)) void classScope.refresh()
            if (key === 'details' && isCourseClassTab(tab)) setPanelVisit((visit) => visit + 1)
            setTab(key as DrawerTab)
          }}
          items={[
            // PORTAL-04: the «فتح الاشتراك» panel gates itself on classes.manage + classes.read.
            { key: 'details', label: t('courses.drawer.tabs.details'), children: <>{editing ? null : <OpenEnrollmentPanel key={panelVisit} course={course} />}{details}</> },
            // MOD-20: the server decides who reads (courses.manage or a teacher of the course) and who edits (`canManage`).
            { key: 'curriculum', label: t('curriculum.tab'), children: <CurriculumTab courseId={course.id} onUnsavedChange={reportUnsaved.curriculum} />, disabled: editing },
            // The class drawer's tabs, on the course's class, with its gates (classes.read first); waiting, like
            // «المنهج», while the edit form is open.
            ...visibleCourseClassTabs(hasPermission).map((key) => ({
              key,
              label: t(COURSE_CLASS_TAB_LABELS[key]),
              children: <CourseClassTabPane tab={key} course={course} scope={classScope} locked={classUnsaved} onUnsavedChange={reportUnsaved} />,
              disabled: editing,
            })),
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
function CourseEditForm({ course, onSaved, onCancel, onUnsavedChange }: CourseEditFormProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  // MOD-19 (D-R122): the price is changed with fee_plans.manage besides courses.manage; without it the form leaves it alone.
  const canPrice = hasPermission('fee_plans.manage')
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
      const field = courseFormField(failure.field)
      if (field) form.setFields([{ name: field, errors: [text] }])
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
      {/* The simplified course form: the fields of the create modal, then the course's materials. */}
      <CourseFormFields />
      {canPrice ? (
        <CoursePricingFields course={course} />
      ) : (
        <Alert type="info" showIcon title={t('courses.hints.pricingReadOnly')} style={{ marginBottom: 16 }} />
      )}
      {/* J-F67: the course's own materials (its textbook), edited here only — the create form has none. */}
      <CourseResourcesField />
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
