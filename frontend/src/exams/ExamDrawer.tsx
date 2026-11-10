// Detail drawer of one exam (J-F45): reads GET /api/exams/:id (API-114) and
// shows it with its class, course, type, linked lesson, date, duration,
// scores, weight, description and lifecycle — the exam's date (and the linked
// lesson's day) in the exam's own `timeZone` (D-R41), named when it is not
// this device's; the lifecycle instants as every drawer shows them — plus the
// server's result counts against the class's active enrollments as read-only
// tags above the tabs. For holders of `exams.manage` (within the class
// visibility the server enforces): an edit form (smallest PATCH — API-116; the
// maximum score locked once a result exists; no edit for an exam of a
// cancelled class) and an actions menu built from the mirrored state machine
// (exams.status.ts → API-117 with an optional reason, and API-118 for a draft
// or scheduled exam without results), each action confirmed in a modal. A
// second tab holds the results sheet (ExamResultsTab — API-119/API-120); a
// saved sheet updates the counts here and in the list row. On the pattern of
// assignments/AssignmentDrawer.tsx, with the guard of lessons/LessonDrawer.tsx
// (KI-058): while the edit form or the results sheet holds unsaved work —
// each reports it, compared with what the server holds, so a change changed
// back holds nothing — Escape and a mask click no longer close the drawer, the
// close button asks first (common.unsaved.*), a browser back/forward asks the
// same question (NavigationBlocker), and a reload or a tab close gets the
// browser's own prompt (useUnsavedChangesGuard). Switching between the two
// tabs is no close: both keep their work.
import { CalendarOutlined, DeleteOutlined, DownOutlined, EditOutlined, EyeInvisibleOutlined, EyeOutlined, UndoOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Descriptions, Drawer, Dropdown, Flex, Form, Input, Modal, Skeleton, Space, Tabs, Tag, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExamResultsSheet } from '../api/examResults'
import { EXAM_STATUS_REASON_MAX_LENGTH, changeExamStatus, deleteExam, getExam, updateExam } from '../api/exams'
import type { Exam } from '../api/exams'
import { formatZonedDateTime, formatZonedDay } from '../assignments/assignments.format'
import { differsFromDevice } from '../assignments/assignments.zone'
import { useAuth } from '../auth/auth-context'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime, localizedLabel } from '../users/users.format'
import { ExamFormFields } from './ExamFormFields'
import { ExamResultsTab } from './ExamResultsTab'
import { describeExamsFailure, failureMessage, isExamsFailure } from './exams.errors'
import { examTitle } from './exams.format'
import { examFormValuesOf } from './exams.form'
import type { ExamFormValues } from './exams.form'
import { examFormHasChanges, lockedFieldUpdates, planExamPatch } from './exams.patch'
import { availableExamActions, examEditability, isClassFrozenForExams, isDangerousExamAction } from './exams.status'
import type { ExamMenuAction } from './exams.status'
import { useExamFormContext } from './useExamFormContext'

const ICONS: Readonly<Record<ExamMenuAction, ReactNode>> = {
  schedule: <CalendarOutlined />,
  unschedule: <UndoOutlined />,
  publish: <EyeOutlined />,
  unpublish: <EyeInvisibleOutlined />,
  delete: <DeleteOutlined />,
}

/** Form fields the edit form renders; a server error naming another field is shown as a message instead. */
const EDIT_FIELDS = new Set(['lessonId', 'type', 'titleAr', 'titleEn', 'descriptionAr', 'descriptionEn', 'scheduledDate', 'scheduledTime', 'durationMinutes', 'maxScore', 'passScore', 'weight'])

/** The exam or its class changed elsewhere (or the exam is gone): the edit form closes and the drawer re-reads it. */
const STALE_EDIT_CODES = ['class_closed', 'exam_not_found']

/** A status action refused because the exam or its class changed elsewhere: the drawer re-reads it. */
const STALE_ACTION_CODES = ['invalid_transition', 'exam_has_results', 'exam_not_deletable', 'class_closed', 'exam_not_found']

/** The tabs of the drawer (API-119 needs `exams.read`, as API-114 does: whoever reads the exam reads its sheet). */
type DrawerTab = 'details' | 'results'

/** The editors that report unsaved work: the edit form of the details tab and the results sheet. */
type EditorPart = 'details' | 'results'

const NOTHING_UNSAVED: Readonly<Record<EditorPart, boolean>> = { details: false, results: false }

interface ExamDrawerProps {
  examId: string | null
  onClose: () => void
  /** The exam the server returned after an edit, a status change or a saved results sheet. */
  onUpdated: (exam: Exam) => void
  /** An exam was deleted. */
  onDeleted: (examId: string) => void
}

export function ExamDrawer({ examId, onClose, onUpdated, onDeleted }: ExamDrawerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('exams.manage')
  const canReadResults = hasPermission('exams.read')
  const [exam, setExam] = useState<Exam | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<ExamMenuAction | null>(null)
  const [tab, setTab] = useState<DrawerTab>('details')
  const [unsavedParts, setUnsavedParts] = useState<Readonly<Record<EditorPart, boolean>>>(NOTHING_UNSAVED)

  // One stable reporter per editor (the results sheet reports from an effect that depends on it).
  const reportUnsaved = useMemo(() => {
    const reporter = (part: EditorPart) => (unsaved: boolean) => setUnsavedParts((current) => (current[part] === unsaved ? current : { ...current, [part]: unsaved }))
    return { details: reporter('details'), results: reporter('results') }
  }, [])
  // While the edit form or the results sheet holds unsaved work, Escape and a mask click must not drop it with the drawer.
  const unsaved = (editing && unsavedParts.details) || unsavedParts.results

  useEffect(() => {
    if (!examId) return
    const controller = new AbortController()
    getExam(examId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setExam(loaded)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const failure = describeExamsFailure(error)
        // An exam that is gone (or out of reach) no longer shows its last known details.
        if (isExamsFailure(failure, 'exam_not_found')) {
          setExam(null)
          setEditing(false)
        }
        setLoadError(failureMessage(t, failure))
      })
    return () => controller.abort()
  }, [examId, reloadTick, t])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  const close = () => {
    setExam(null)
    setLoadError(null)
    setEditing(false)
    setPending(null)
    setTab('details')
    setUnsavedParts(NOTHING_UNSAVED)
    onClose()
  }

  // The close button (Escape and the mask too when nothing is unsaved) asks first while an editor holds unsaved work,
  // and so does a browser back/forward (NavigationBlocker below) — one question (common.unsaved.*); a reload or a tab
  // close gets the browser's own prompt (KI-055, KI-058).
  const { requestClose, holdNavigation } = useUnsavedChangesGuard(unsaved, close)

  const applyUpdate = (updated: Exam) => {
    setExam(updated)
    onUpdated(updated)
  }

  /** The counts the server answered with the saved sheet (no count of our own); the exam row itself is unchanged. */
  const applyResults = (sheet: ExamResultsSheet) => {
    if (exam && exam.id === sheet.examId) applyUpdate({ ...exam, results: sheet.counts })
  }

  const editability = exam ? examEditability(exam, canManage) : { editable: false, maxScoreLocked: false }
  const actions = exam && !editing ? availableExamActions(exam, canManage) : []
  const menu: MenuProps['items'] = actions.map((action) => ({
    key: action,
    label: t(`exams.actions.${action}`),
    icon: ICONS[action],
    danger: isDangerousExamAction(action),
  }))

  const title = exam ? examTitle(exam, language) : t('exams.drawer.title')

  /** The details of the exam, or its edit form while editing. */
  const detailsPane = (current: Exam) =>
    editing ? (
      <ExamEditForm
        // Remount per server version so the form starts from what the server holds (KI-049).
        key={`${current.id}:${current.updatedAt}`}
        exam={current}
        maxScoreLocked={editability.maxScoreLocked}
        onSaved={(updated) => {
          applyUpdate(updated)
          setEditing(false)
        }}
        onStale={() => {
          setEditing(false)
          reload()
        }}
        onRefresh={reload}
        onCancel={() => setEditing(false)}
        onUnsavedChange={reportUnsaved.details}
      />
    ) : (
      <ExamDetails exam={current} />
    )

  return (
    <Drawer
      open={examId !== null}
      onClose={requestClose}
      // Unsaved work turns off the Escape key and the mask click; a modal, Select or Dropdown open on top still closes
      // on Escape (it sits above the drawer).
      keyboard={!unsaved}
      mask={{ closable: !unsaved }}
      title={
        exam ? (
          <Space wrap>
            <span>{title}</span>
            <StatusTag value={exam.status} />
          </Space>
        ) : (
          title
        )
      }
      // antd 6: `size` takes a CSS length; the panel never exceeds a phone viewport.
      size="min(760px, 100vw)"
      destroyOnHidden
      extra={
        exam && !editing && (editability.editable || menu.length > 0) ? (
          <Space>
            {editability.editable ? (
              <Button
                icon={<EditOutlined />}
                onClick={() => {
                  setEditing(true)
                  setTab('details')
                }}
              >
                {t('common.edit')}
              </Button>
            ) : null}
            {menu.length > 0 ? (
              <Dropdown trigger={['click']} destroyOnHidden menu={{ items: menu, onClick: ({ key }) => setPending(key as ExamMenuAction) }}>
                <Button icon={<DownOutlined />} iconPlacement="end">
                  {t('exams.actions.menu')}
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
          title={loadError}
          action={
            <Button size="small" onClick={reload}>
              {t('exams.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {!exam && !loadError ? <Skeleton active paragraph={{ rows: 8 }} data-testid="exam-loading" /> : null}

      {exam && canManage && isClassFrozenForExams(exam.class.status) ? <Alert type="warning" showIcon title={t('exams.drawer.classCancelled')} style={{ marginBottom: 16 }} /> : null}
      {exam ? <Alert type="info" showIcon title={t(`exams.drawer.statusHint.${exam.status}`)} style={{ marginBottom: 16 }} data-testid="exam-status-hint" /> : null}

      {exam ? (
        <>
          {/* The server's counts above both tabs: after a saved sheet they follow its answer (applyResults). */}
          <div style={{ marginBottom: 16 }}>
            <ExamResultsSummary exam={exam} />
          </div>
          {canReadResults ? (
            <Tabs
              activeKey={tab}
              onChange={(key) => setTab(key as DrawerTab)}
              items={[
                { key: 'details', label: t('exams.drawer.tabs.details'), children: detailsPane(exam) },
                {
                  key: 'results',
                  label: t('exams.drawer.tabs.results'),
                  // Re-read when the exam leaves or reaches draft here (that decides whether it takes results); publish
                  // and unpublish keep the sheet and its unsaved rows.
                  children: (
                    <ExamResultsTab
                      key={`${exam.id}:${exam.status === 'draft'}`}
                      exam={exam}
                      onSaved={applyResults}
                      onExamStale={reload}
                      onUnsavedChange={reportUnsaved.results}
                    />
                  ),
                },
              ]}
            />
          ) : (
            detailsPane(exam)
          )}
        </>
      ) : null}

      {exam && pending ? (
        <ExamActionModal
          // Mounted per action, so the reason never carries over to the next one.
          exam={exam}
          action={pending}
          onDone={(updated) => {
            setPending(null)
            if (updated) applyUpdate(updated)
            else {
              onDeleted(exam.id)
              close()
            }
          }}
          onStale={reload}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </Drawer>
  )
}

/** An instant in the exam's own zone (D-R41); the zone is named when it is not this device's. */
function ZonedAt({ iso, zone }: { iso: string; zone: string }) {
  const { language } = useLocalized()
  return (
    <Space wrap size={4}>
      <span>{formatZonedDateTime(iso, zone, language)}</span>
      {differsFromDevice(zone) ? (
        <Typography.Text type="secondary">
          (<span dir="ltr">{zone}</span>)
        </Typography.Text>
      ) : null}
    </Space>
  )
}

function ExamDetails({ exam }: { exam: Exam }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const dash = '—'
  const zone = exam.timeZone

  return (
    <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
      <Descriptions.Item label={t('exams.fields.class')}>
        <Space wrap>
          <Typography.Text dir="ltr" strong>
            {exam.class.code}
          </Typography.Text>
          <span>{localizedLabel(exam.class.name, language)}</span>
          {exam.class.status === 'completed' || exam.class.status === 'cancelled' ? <StatusTag value={exam.class.status} /> : null}
        </Space>
      </Descriptions.Item>
      <Descriptions.Item label={t('exams.columns.course')}>
        {localizedLabel(exam.class.course.name, language)} (<span dir="ltr">{exam.class.course.code}</span>)
      </Descriptions.Item>
      <Descriptions.Item label={t('exams.fields.type')}>
        <Tag>{t(`exams.types.${exam.type}`)}</Tag>
      </Descriptions.Item>
      <Descriptions.Item label={t('exams.fields.lesson')}>
        {exam.lesson ? (
          `${formatZonedDay(exam.lesson.startsAt, zone, language)} — ${localizedLabel(exam.lesson.title, language)}`
        ) : (
          <Typography.Text type="secondary">{t('exams.drawer.noLesson')}</Typography.Text>
        )}
      </Descriptions.Item>
      <Descriptions.Item label={t('exams.fields.scheduledAt')}>
        {exam.scheduledAt ? <ZonedAt iso={exam.scheduledAt} zone={zone} /> : <Typography.Text type="secondary">{t('exams.drawer.noDate')}</Typography.Text>}
      </Descriptions.Item>
      <Descriptions.Item label={t('exams.fields.durationMinutes')}>
        {exam.durationMinutes !== null ? t('exams.drawer.minutes', { count: exam.durationMinutes }) : dash}
      </Descriptions.Item>
      <Descriptions.Item label={t('exams.fields.maxScore')}>
        <span dir="ltr">{exam.maxScore}</span>
      </Descriptions.Item>
      <Descriptions.Item label={t('exams.fields.passScore')}>{exam.passScore !== null ? <span dir="ltr">{exam.passScore}</span> : dash}</Descriptions.Item>
      <Descriptions.Item label={t('exams.fields.weight')}>
        {exam.weight !== null ? <span dir="ltr">{exam.weight}</span> : <Typography.Text type="secondary">{t('exams.drawer.informational')}</Typography.Text>}
      </Descriptions.Item>
      <Descriptions.Item label={t('exams.fields.descriptionAr')}>
        <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{exam.description?.ar || dash}</Typography.Paragraph>
      </Descriptions.Item>
      {exam.description?.en ? (
        <Descriptions.Item label={t('exams.fields.descriptionEn')}>
          <Typography.Paragraph dir="ltr" style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
            {exam.description.en}
          </Typography.Paragraph>
        </Descriptions.Item>
      ) : null}
      {/* The lifecycle instants read like every other drawer's (this device's zone); `timeZone` is the exam date's (API-113). */}
      {exam.publishedAt ? <Descriptions.Item label={t('exams.fields.publishedAt')}>{formatDateTime(exam.publishedAt, language)}</Descriptions.Item> : null}
      <Descriptions.Item label={t('exams.fields.createdAt')}>{formatDateTime(exam.createdAt, language)}</Descriptions.Item>
      <Descriptions.Item label={t('exams.fields.updatedAt')}>{formatDateTime(exam.updatedAt, language)}</Descriptions.Item>
    </Descriptions>
  )
}

/** The result counts the server computes against the class's active enrollments — read-only. */
export function ExamResultsSummary({ exam }: { exam: Pick<Exam, 'results' | 'activeStudents'> }) {
  const { t } = useTranslation()
  const { results } = exam
  return (
    <Card size="small" title={t('exams.summary.title')} data-testid="exam-results-summary">
      <Space wrap>
        <Tag>{t('exams.summary.students', { count: results.students, total: exam.activeStudents })}</Tag>
        <Tag color="green">{t('exams.summary.scored', { count: results.scored })}</Tag>
        <Tag color="red">{t('exams.summary.absent', { count: results.absent })}</Tag>
        <Tag color="blue">{t('exams.summary.excused', { count: results.excused })}</Tag>
      </Space>
    </Card>
  )
}

interface ExamActionModalProps {
  exam: Exam
  action: ExamMenuAction
  /** The exam after a status change, or null after a deletion. */
  onDone: (exam: Exam | null) => void
  /** The exam changed elsewhere meanwhile: re-read it. */
  onStale: () => void
  onCancel: () => void
}

function ExamActionModal({ exam, action, onDone, onStale, onCancel }: ExamActionModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = examTitle(exam, language)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      if (action === 'delete') {
        await deleteExam(exam.id)
        message.success(t('exams.done.delete'))
        onDone(null)
        return
      }
      const trimmed = reason.trim()
      const updated = await changeExamStatus(exam.id, trimmed ? { action, reason: trimmed } : { action })
      message.success(t(`exams.done.${action}`))
      onDone(updated)
    } catch (caught) {
      const failure = describeExamsFailure(caught)
      setError(failureMessage(t, failure))
      if (STALE_ACTION_CODES.some((code) => isExamsFailure(failure, code))) onStale()
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={t('exams.confirm.title', { action: t(`exams.actions.${action}`), name })}
      okText={t(`exams.actions.${action}`)}
      okButtonProps={{ danger: isDangerousExamAction(action) }}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => void confirm()}
      onCancel={() => {
        if (!busy) onCancel()
      }}
    >
      <Typography.Paragraph>{t(`exams.confirm.${action}`)}</Typography.Paragraph>
      {action !== 'delete' ? (
        <Form layout="vertical">
          <Form.Item label={t('exams.confirm.reason')} extra={t('exams.confirm.reasonAudit')} htmlFor="exam-status-reason">
            <Input.TextArea id="exam-status-reason" rows={2} maxLength={EXAM_STATUS_REASON_MAX_LENGTH} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} />
          </Form.Item>
        </Form>
      ) : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Modal>
  )
}

interface ExamEditFormProps {
  exam: Exam
  maxScoreLocked: boolean
  onSaved: (exam: Exam) => void
  /** The server refused the save because the exam or its class changed elsewhere: close the form and re-read. */
  onStale: () => void
  /** Re-read the exam while the form stays open (a result arrived meanwhile: the maximum score locks). */
  onRefresh: () => void
  onCancel: () => void
  /** Whether a field holds unsaved work: reported on every change, false once saved or left. */
  onUnsavedChange: (unsaved: boolean) => void
}

/**
 * The edit form of one edit session. It owns its form so every session starts
 * from the exam as the server holds it (KI-049). The exam's date is typed in
 * the exam's zone, or in the zone a newly linked lesson gives it
 * (useExamFormContext()). `exam_locked` for the maximum score (a result was
 * recorded meanwhile) puts the stored value back into that field with the
 * reason, keeps the other changes and re-reads the exam so the field locks;
 * anything that makes the whole form stale closes it. It reports unsaved work
 * from onValuesChange — synchronous, where Form.useWatch would report a task
 * late, after an Escape (J-F23) — compared with the exam as loaded through
 * examFormHasChanges().
 */
function ExamEditForm({ exam, maxScoreLocked, onSaved, onStale, onRefresh, onCancel, onUnsavedChange }: ExamEditFormProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const context = useExamFormContext(form, exam.class.id, exam)
  const zone = context.zone.zone

  // The form left (saved, cancelled, stale, or the drawer closed) — nothing is held any more.
  useEffect(() => () => onUnsavedChange(false), [onUnsavedChange])

  const save = async (values: ExamFormValues) => {
    const body = planExamPatch(exam, values, zone)
    if (!body) {
      message.info(t('exams.drawer.nothingChanged'))
      onUnsavedChange(false)
      onCancel()
      return
    }
    setSaving(true)
    try {
      const updated = await updateExam(exam.id, body)
      message.success(t('exams.drawer.saved'))
      // Saved: nothing is left to lose, even before the drawer closes the form.
      onUnsavedChange(false)
      onSaved(updated)
    } catch (caught) {
      const failure = describeExamsFailure(caught)
      const text = failureMessage(t, failure)
      if (STALE_EDIT_CODES.some((code) => isExamsFailure(failure, code))) {
        message.error(text)
        onStale()
        return
      }
      if (isExamsFailure(failure, 'exam_locked') && failure.lockedFields?.length) {
        message.warning(text)
        form.setFields(lockedFieldUpdates(exam, failure.lockedFields, t('exams.validation.lockedAfterResult')))
        onRefresh()
      } else if (failure.field && EDIT_FIELDS.has(failure.field[0] ?? '')) form.setFields([{ name: failure.field, errors: [text] }])
      else message.error(text)
      setSaving(false)
    }
  }

  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={examFormValuesOf(exam)}
      // Compared with the exam as loaded on every change, so a change changed back holds nothing.
      onValuesChange={(_changed, values) => onUnsavedChange(examFormHasChanges(exam, values as ExamFormValues, zone))}
      onFinish={(values) => void save(values as ExamFormValues)}
      disabled={saving}
    >
      <ExamFormFields form={form} mode="edit" hasClass context={context} current={exam} maxScoreLocked={maxScoreLocked} />
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
