// Detail drawer of one assignment (J-F38): reads GET /api/assignments/:id
// (API-103) and shows it with its class, course, linked lesson, due date,
// grading rules, instructions and lifecycle — the due date (and the linked
// lesson's day) in the assignment's own `timeZone` (D-R41), named when it is
// not this device's; the lifecycle instants as every drawer shows them —
// plus the submission counts against the class's active enrollments as
// read-only tags above the tabs. For holders of `assignments.manage` (within
// the class visibility the server enforces): an edit form (smallest PATCH —
// API-105; the grading rules locked once a submission exists; no edit of a
// closed assignment or of an assignment of a closed class) and an actions menu
// built from the mirrored state machine (assignments.status.ts → API-106 with
// an optional reason, and API-107 for a draft without submissions), each
// action confirmed in a modal. Since J-F41 a second tab holds the submissions
// roster (AssignmentSubmissionsTab — API-108) and its review panel
// (API-110/API-111); a review's answer carries the attempt only, so the drawer
// then reads the assignment again for its counts and hands it to the list.
// Since J-F55 (KI-062 — the owner's note 1 on #106; the guard of the class,
// user, course, lesson and exam drawers: KI-052, KI-054, KI-055, KI-058): while
// the edit form holds unsaved work — compared with the assignment as the server
// holds it through assignmentFormHasChanges(), so a change changed back holds
// nothing — Escape and a mask click no longer close the drawer, the close
// button asks first (common.unsaved.*), a browser back/forward asks the same
// question (NavigationBlocker), and a reload or a tab close gets the browser's
// own prompt (useUnsavedChangesGuard). The edit form's Cancel stays an explicit
// discard; switching to the submissions tab is no close. The review panel keeps
// its own guard (Escape, mask, ×) and is not part of this one.
import { CheckCircleOutlined, DeleteOutlined, DownOutlined, EditOutlined, LockOutlined, UndoOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Descriptions, Drawer, Dropdown, Flex, Form, Input, Modal, Skeleton, Space, Tabs, Tag, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ASSIGNMENT_STATUS_REASON_MAX_LENGTH, changeAssignmentStatus, deleteAssignment, getAssignment, updateAssignment } from '../api/assignments'
import type { Assignment } from '../api/assignments'
import { useAuth } from '../auth/auth-context'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime, localizedLabel } from '../users/users.format'
import { AssignmentFormFields } from './AssignmentFormFields'
import { AssignmentSubmissionsTab } from './AssignmentSubmissionsTab'
import { describeAssignmentsFailure, failureMessage, isAssignmentsFailure } from './assignments.errors'
import { assignmentTitle, formatZonedDateTime, formatZonedDay } from './assignments.format'
import { assignmentFormValuesOf } from './assignments.form'
import type { AssignmentFormValues } from './assignments.form'
import { assignmentFormHasChanges, lockedFieldUpdates, planAssignmentPatch } from './assignments.patch'
import { assignmentEditability, availableAssignmentActions, isClassOpenForAssignments, isDangerousAssignmentAction } from './assignments.status'
import type { AssignmentMenuAction } from './assignments.status'
import { differsFromDevice } from './assignments.zone'
import { useAssignmentFormContext } from './useAssignmentFormContext'

const ICONS: Readonly<Record<AssignmentMenuAction, ReactNode>> = {
  publish: <CheckCircleOutlined />,
  close: <LockOutlined />,
  reopen: <UndoOutlined />,
  delete: <DeleteOutlined />,
}

/** Form fields the edit form renders; a server error naming another field is shown as a message instead. */
const EDIT_FIELDS = new Set(['lessonId', 'titleAr', 'titleEn', 'instructionsAr', 'instructionsEn', 'maxScore', 'weight', 'dueDate', 'dueTime', 'allowLate', 'latePenaltyPercent', 'maxAttempts'])

/** The assignment or its class changed elsewhere (or the assignment is gone): the edit form closes and the drawer re-reads it. */
const STALE_EDIT_CODES = ['class_closed', 'assignment_not_found']

/** A status action refused because the assignment or its class changed elsewhere: the drawer re-reads it. */
const STALE_ACTION_CODES = ['invalid_transition', 'assignment_not_deletable', 'class_closed', 'assignment_not_found']

/** The tabs of the drawer for holders of `assignments.read` (everyone who reaches it — API-103 needs the key too). */
type DrawerTab = 'details' | 'submissions'

interface AssignmentDrawerProps {
  assignmentId: string | null
  onClose: () => void
  /** The assignment the server returned after an edit or a status change. */
  onUpdated: (assignment: Assignment) => void
  /** A draft was deleted. */
  onDeleted: (assignmentId: string) => void
}

export function AssignmentDrawer({ assignmentId, onClose, onUpdated, onDeleted }: AssignmentDrawerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('assignments.manage')
  // API-108 needs the same key and class visibility as API-103: whoever reads the assignment reads its roster.
  const canReadSubmissions = hasPermission('assignments.read')
  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<AssignmentMenuAction | null>(null)
  const [tab, setTab] = useState<DrawerTab>('details')
  // KI-062: whether the edit form holds unsaved work — reported by the form on every change, false once it leaves.
  const [formUnsaved, setFormUnsaved] = useState(false)
  const unsaved = editing && formUnsaved

  useEffect(() => {
    if (!assignmentId) return
    const controller = new AbortController()
    getAssignment(assignmentId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setAssignment(loaded)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const failure = describeAssignmentsFailure(error)
        // An assignment that is gone (or out of reach) no longer shows its last known details.
        if (isAssignmentsFailure(failure, 'assignment_not_found')) {
          setAssignment(null)
          setEditing(false)
        }
        setLoadError(failureMessage(t, failure))
      })
    return () => controller.abort()
  }, [assignmentId, reloadTick, t])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  const close = () => {
    setAssignment(null)
    setLoadError(null)
    setEditing(false)
    setPending(null)
    setTab('details')
    setFormUnsaved(false)
    onClose()
  }

  // The close button (Escape and the mask too when nothing is unsaved) asks first while the edit form holds unsaved
  // work, and so does a browser back/forward (NavigationBlocker below) — one question (common.unsaved.*); a reload or
  // a tab close gets the browser's own prompt (KI-055, KI-062).
  const { requestClose, holdNavigation } = useUnsavedChangesGuard(unsaved, close)

  const applyUpdate = (updated: Assignment) => {
    setAssignment(updated)
    onUpdated(updated)
  }

  /** The re-read of the counts in flight: a newer one aborts it, so an older answer never lands after a newer one. */
  const countsRequest = useRef<AbortController | null>(null)
  useEffect(() => () => countsRequest.current?.abort(), [])

  /**
   * After a review (J-F41): the answer of API-111 carries the reviewed attempt only — not the assignment's
   * `submissions` counts — so the drawer reads the assignment again (API-103), shows its counts and hands it
   * to the list row, as a write's answer would. A failed read re-reads the drawer the usual way. Two reviews in
   * quick succession start two reads: the second aborts the first (J-F47), so the counts shown are the newest.
   */
  const refreshCounts = () => {
    if (!assignmentId) return
    countsRequest.current?.abort()
    const controller = new AbortController()
    countsRequest.current = controller
    getAssignment(assignmentId, controller.signal)
      .then((fresh) => {
        if (controller.signal.aborted) return
        // The drawer may show another assignment by now; the list row is right either way.
        setAssignment((current) => (current && current.id === fresh.id ? fresh : current))
        onUpdated(fresh)
      })
      .catch(() => {
        if (!controller.signal.aborted) reload()
      })
  }

  const editability = assignment ? assignmentEditability(assignment, canManage) : { editable: false, gradingLocked: false }
  const actions = assignment && !editing ? availableAssignmentActions(assignment, canManage) : []
  const menu: MenuProps['items'] = actions.map((action) => ({
    key: action,
    label: t(`assignments.actions.${action}`),
    icon: ICONS[action],
    danger: isDangerousAssignmentAction(action),
  }))

  const title = assignment ? assignmentTitle(assignment, language) : t('assignments.drawer.title')
  const classOpen = assignment ? isClassOpenForAssignments(assignment.class.status) : true

  /** The details of the assignment, or its edit form while editing. */
  const detailsPane = (current: Assignment) =>
    editing ? (
      <AssignmentEditForm
        // Remount per server version so the form starts from what the server holds (KI-049).
        key={`${current.id}:${current.updatedAt}`}
        assignment={current}
        gradingLocked={editability.gradingLocked}
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
        onUnsavedChange={setFormUnsaved}
      />
    ) : (
      <AssignmentDetails assignment={current} />
    )

  return (
    <Drawer
      open={assignmentId !== null}
      onClose={requestClose}
      // KI-062: unsaved work turns off the Escape key and the mask click; a modal, Select or Dropdown open on top
      // (the review panel included) still closes on Escape — it sits above the drawer.
      keyboard={!unsaved}
      mask={{ closable: !unsaved }}
      title={
        assignment ? (
          <Space wrap>
            <span>{title}</span>
            <StatusTag value={assignment.status} />
          </Space>
        ) : (
          title
        )
      }
      // antd 6: `size` takes a CSS length; the panel never exceeds a phone viewport.
      size="min(760px, 100vw)"
      destroyOnHidden
      extra={
        assignment && !editing && (editability.editable || menu.length > 0) ? (
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
              <Dropdown trigger={['click']} destroyOnHidden menu={{ items: menu, onClick: ({ key }) => setPending(key as AssignmentMenuAction) }}>
                <Button icon={<DownOutlined />} iconPlacement="end">
                  {t('assignments.actions.menu')}
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
              {t('assignments.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {!assignment && !loadError ? <Skeleton active paragraph={{ rows: 8 }} data-testid="assignment-loading" /> : null}

      {assignment && canManage && !classOpen ? <Alert type="warning" showIcon title={t('assignments.drawer.classClosed')} style={{ marginBottom: 16 }} /> : null}
      {assignment && canManage && classOpen && assignment.status === 'closed' ? <Alert type="info" showIcon title={t('assignments.drawer.closedHint')} style={{ marginBottom: 16 }} /> : null}

      {assignment ? (
        <>
          {/* The server's counts above both tabs: after a review they follow the re-read of API-103 (refreshCounts). */}
          <div style={{ marginBottom: 16 }}>
            <AssignmentSubmissionsSummary assignment={assignment} />
          </div>
          {canReadSubmissions ? (
            <Tabs
              activeKey={tab}
              onChange={(key) => setTab(key as DrawerTab)}
              items={[
                { key: 'details', label: t('assignments.drawer.tabs.details'), children: detailsPane(assignment) },
                {
                  key: 'submissions',
                  label: t('assignments.drawer.tabs.submissions'),
                  children: <AssignmentSubmissionsTab key={assignment.id} assignment={assignment} onReviewed={refreshCounts} onAssignmentStale={reload} />,
                },
              ]}
            />
          ) : (
            detailsPane(assignment)
          )}
        </>
      ) : null}

      {assignment && pending ? (
        <AssignmentActionModal
          // Mounted per action, so the reason never carries over to the next one.
          assignment={assignment}
          action={pending}
          onDone={(updated) => {
            setPending(null)
            if (updated) applyUpdate(updated)
            else {
              onDeleted(assignment.id)
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

/** The due date in the assignment's own zone (D-R41); the zone is named when it is not this device's. */
function DueAt({ iso, zone }: { iso: string; zone: string }) {
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

function AssignmentDetails({ assignment }: { assignment: Assignment }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const dash = '—'
  const zone = assignment.timeZone
  const latePolicy = !assignment.allowLate
    ? t('assignments.drawer.lateNotAllowed')
    : assignment.latePenaltyPercent !== null
      ? t('assignments.drawer.lateAllowedWithPenalty', { percent: assignment.latePenaltyPercent })
      : t('assignments.drawer.lateAllowed')

  return (
    <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
      <Descriptions.Item label={t('assignments.fields.class')}>
        <Space wrap>
          <Typography.Text dir="ltr" strong>
            {assignment.class.code}
          </Typography.Text>
          <span>{localizedLabel(assignment.class.name, language)}</span>
          {!isClassOpenForAssignments(assignment.class.status) ? <StatusTag value={assignment.class.status} /> : null}
        </Space>
      </Descriptions.Item>
      <Descriptions.Item label={t('assignments.columns.course')}>
        {localizedLabel(assignment.class.course.name, language)} (<span dir="ltr">{assignment.class.course.code}</span>)
      </Descriptions.Item>
      <Descriptions.Item label={t('assignments.fields.lesson')}>
        {assignment.lesson ? (
          `${formatZonedDay(assignment.lesson.startsAt, zone, language)} — ${localizedLabel(assignment.lesson.title, language)}`
        ) : (
          <Typography.Text type="secondary">{t('assignments.drawer.noLesson')}</Typography.Text>
        )}
      </Descriptions.Item>
      <Descriptions.Item label={t('assignments.fields.due')}>
        {assignment.dueAt ? <DueAt iso={assignment.dueAt} zone={zone} /> : <Typography.Text type="secondary">{t('assignments.drawer.noDue')}</Typography.Text>}
      </Descriptions.Item>
      <Descriptions.Item label={t('assignments.fields.maxScore')}>{assignment.maxScore}</Descriptions.Item>
      <Descriptions.Item label={t('assignments.fields.weight')}>{assignment.weight ?? dash}</Descriptions.Item>
      <Descriptions.Item label={t('assignments.fields.latePolicy')}>{latePolicy}</Descriptions.Item>
      <Descriptions.Item label={t('assignments.fields.maxAttempts')}>{assignment.maxAttempts}</Descriptions.Item>
      <Descriptions.Item label={t('assignments.fields.instructionsAr')}>
        <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{assignment.instructions?.ar || dash}</Typography.Paragraph>
      </Descriptions.Item>
      {assignment.instructions?.en ? (
        <Descriptions.Item label={t('assignments.fields.instructionsEn')}>
          <Typography.Paragraph dir="ltr" style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
            {assignment.instructions.en}
          </Typography.Paragraph>
        </Descriptions.Item>
      ) : null}
      {/* The lifecycle instants read like every other drawer's (this device's zone); `timeZone` is the due date's (API-102). */}
      {assignment.publishedAt ? <Descriptions.Item label={t('assignments.fields.publishedAt')}>{formatDateTime(assignment.publishedAt, language)}</Descriptions.Item> : null}
      {assignment.closedAt ? <Descriptions.Item label={t('assignments.fields.closedAt')}>{formatDateTime(assignment.closedAt, language)}</Descriptions.Item> : null}
      <Descriptions.Item label={t('assignments.fields.createdAt')}>{formatDateTime(assignment.createdAt, language)}</Descriptions.Item>
      <Descriptions.Item label={t('assignments.fields.updatedAt')}>{formatDateTime(assignment.updatedAt, language)}</Descriptions.Item>
    </Descriptions>
  )
}

/** The submission counts the server computes (latest attempt per student) against the class's active enrollments — read-only. */
export function AssignmentSubmissionsSummary({ assignment }: { assignment: Pick<Assignment, 'submissions' | 'activeStudents'> }) {
  const { t } = useTranslation()
  const { submissions } = assignment
  return (
    <Card size="small" title={t('assignments.submissions.title')} data-testid="assignment-submissions">
      <Space wrap>
        <Tag>{t('assignments.submissions.students', { count: submissions.students, total: assignment.activeStudents })}</Tag>
        <Tag color="gold">{t('assignments.submissions.submitted', { count: submissions.submitted })}</Tag>
        <Tag color="green">{t('assignments.submissions.graded', { count: submissions.graded })}</Tag>
        <Tag color="orange">{t('assignments.submissions.returned', { count: submissions.returned })}</Tag>
      </Space>
    </Card>
  )
}

interface AssignmentActionModalProps {
  assignment: Assignment
  action: AssignmentMenuAction
  /** The assignment after a status change, or null after a deletion. */
  onDone: (assignment: Assignment | null) => void
  /** The assignment changed elsewhere meanwhile: re-read it. */
  onStale: () => void
  onCancel: () => void
}

function AssignmentActionModal({ assignment, action, onDone, onStale, onCancel }: AssignmentActionModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = assignmentTitle(assignment, language)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      if (action === 'delete') {
        await deleteAssignment(assignment.id)
        message.success(t('assignments.done.delete'))
        onDone(null)
        return
      }
      const trimmed = reason.trim()
      const updated = await changeAssignmentStatus(assignment.id, trimmed ? { action, reason: trimmed } : { action })
      message.success(t(`assignments.done.${action}`))
      onDone(updated)
    } catch (caught) {
      const failure = describeAssignmentsFailure(caught)
      setError(failureMessage(t, failure))
      if (STALE_ACTION_CODES.some((code) => isAssignmentsFailure(failure, code))) onStale()
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={t('assignments.confirm.title', { action: t(`assignments.actions.${action}`), name })}
      okText={t(`assignments.actions.${action}`)}
      okButtonProps={{ danger: isDangerousAssignmentAction(action) }}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => void confirm()}
      onCancel={() => {
        if (!busy) onCancel()
      }}
    >
      <Typography.Paragraph>{t(`assignments.confirm.${action}`)}</Typography.Paragraph>
      {action !== 'delete' ? (
        <Form layout="vertical">
          <Form.Item label={t('assignments.confirm.reason')} extra={t('assignments.confirm.reasonAudit')} htmlFor="assignment-status-reason">
            <Input.TextArea
              id="assignment-status-reason"
              rows={2}
              maxLength={ASSIGNMENT_STATUS_REASON_MAX_LENGTH}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
            />
          </Form.Item>
        </Form>
      ) : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Modal>
  )
}

interface AssignmentEditFormProps {
  assignment: Assignment
  gradingLocked: boolean
  onSaved: (assignment: Assignment) => void
  /** The server refused the save because the assignment or its class changed elsewhere: close the form and re-read. */
  onStale: () => void
  /** Re-read the assignment while the form stays open (a submission arrived meanwhile: the grading rules lock). */
  onRefresh: () => void
  onCancel: () => void
  /** Whether a field holds unsaved work (KI-062): reported on every change, false once saved or left. */
  onUnsavedChange: (unsaved: boolean) => void
}

/**
 * The edit form of one edit session. It owns its form so every session starts
 * from the assignment as the server holds it (KI-049). The due date is typed
 * in the assignment's zone, or in the zone a newly linked lesson gives it
 * (useAssignmentFormContext()). `assignment_locked` for the grading rules (a
 * student submitted meanwhile) puts the stored values back into those fields
 * with the reason, keeps the other changes and re-reads the assignment so the
 * fields lock; anything that makes the whole form stale closes it. It reports
 * unsaved work (KI-062) from onValuesChange — synchronous, where Form.useWatch
 * would report a task late, after an Escape (J-F23) — compared with the
 * assignment as loaded through assignmentFormHasChanges().
 */
function AssignmentEditForm({ assignment, gradingLocked, onSaved, onStale, onRefresh, onCancel, onUnsavedChange }: AssignmentEditFormProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const context = useAssignmentFormContext(form, assignment.class.id, assignment)
  const zone = context.dueZone.zone

  /** What the form holds now, against the assignment as loaded. */
  const holdsChanges = () => assignmentFormHasChanges(assignment, form.getFieldsValue() as AssignmentFormValues, zone)

  // KI-062: the form left (saved, cancelled, stale, or the drawer closed) — nothing is held any more.
  useEffect(() => () => onUnsavedChange(false), [onUnsavedChange])

  // The due date's zone moved (another lesson linked, its zone or the academy's read only now) or the assignment was
  // read again (after `assignment_locked`): what the form holds is compared again before the frame is painted.
  useLayoutEffect(() => {
    onUnsavedChange(assignmentFormHasChanges(assignment, form.getFieldsValue() as AssignmentFormValues, zone))
  }, [assignment, form, onUnsavedChange, zone])

  const save = async (values: AssignmentFormValues) => {
    const body = planAssignmentPatch(assignment, values, zone)
    if (!body) {
      message.info(t('assignments.drawer.nothingChanged'))
      onUnsavedChange(false)
      onCancel()
      return
    }
    setSaving(true)
    try {
      const updated = await updateAssignment(assignment.id, body)
      message.success(t('assignments.drawer.saved'))
      // Saved: nothing is left to lose, even before the drawer closes the form.
      onUnsavedChange(false)
      onSaved(updated)
    } catch (caught) {
      const failure = describeAssignmentsFailure(caught)
      const text = failureMessage(t, failure)
      const locked = isAssignmentsFailure(failure, 'assignment_locked')
      if (STALE_EDIT_CODES.some((code) => isAssignmentsFailure(failure, code)) || (locked && failure.lockedStatus === 'closed')) {
        message.error(text)
        onStale()
        return
      }
      if (locked && failure.lockedFields?.length) {
        message.warning(text)
        form.setFields(lockedFieldUpdates(assignment, failure.lockedFields, t('assignments.validation.lockedAfterSubmission')))
        // The refused fields hold the stored values again (setFields reports no change): only the other changes are left.
        onUnsavedChange(holdsChanges())
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
      initialValues={assignmentFormValuesOf(assignment)}
      // KI-062: compared with the assignment as loaded on every change, so a change changed back holds nothing.
      onValuesChange={(_changed, values) => onUnsavedChange(assignmentFormHasChanges(assignment, values as AssignmentFormValues, zone))}
      onFinish={(values) => void save(values as AssignmentFormValues)}
      disabled={saving}
    >
      <AssignmentFormFields form={form} mode="edit" hasClass context={context} current={assignment} gradingLocked={gradingLocked} />
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
