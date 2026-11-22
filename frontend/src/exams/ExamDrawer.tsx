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
//
// MOD-09 phase 2 — an ONLINE exam (a manual one shows and does what it always
// did). The details add its delivery, its window (opens / closes, in the exam's
// zone), one attempt's time limit, the attempts allowed, when a learner sees
// their result, whether the correct answers are revealed, and the server's
// summary: the linked questions with their points against the maximum score,
// and who has taken it. An online draft lists what still keeps it from being
// made available (`exam.online.problems` — the server's list, at its clock),
// each with where it is put right. The status hint and the confirmation of
// each action say what they mean for an online exam; the refusals of the
// actions are worded: `exam_not_ready` (its problems), `exam_has_attempts`,
// `exam_window_open` (when the window closes) and `exam_not_deletable` for an
// exam somebody has started. The edit form asks before it turns an online
// draft manual (its questions are unlinked) and before it extends a closed
// window of an exam that reveals its answers (KI-130 — a warning the server
// does not give); `exam_locked` puts each refused field back with its own
// reason. The question set and the attempts live in their own tabs.
import { CalendarOutlined, DeleteOutlined, DownOutlined, EditOutlined, EyeInvisibleOutlined, EyeOutlined, UndoOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Descriptions, Drawer, Dropdown, Flex, Form, Input, Modal, Skeleton, Space, Tabs, Tag, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExamResultsSheet } from '../api/examResults'
import { EXAM_STATUS_REASON_MAX_LENGTH, changeExamStatus, deleteExam, getExam, updateExam } from '../api/exams'
import type { Exam, UpdateExamInput } from '../api/exams'
import { formatZonedDateTime, formatZonedDay } from '../assignments/assignments.format'
import { differsFromDevice } from '../assignments/assignments.zone'
import { useAuth } from '../auth/auth-context'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime, localizedLabel } from '../users/users.format'
import { ExamAttemptsTab } from './ExamAttemptsTab'
import { ExamFormFields } from './ExamFormFields'
import { ExamQuestionsTab } from './ExamQuestionsTab'
import { ExamResultsTab } from './ExamResultsTab'
import { describeExamsFailure, failureMessage, isExamsFailure, lockedFieldMessageKey } from './exams.errors'
import type { ExamsFailure } from './exams.errors'
import { examTitle, readinessFixOf, readinessProblemText } from './exams.format'
import type { ReadinessNumbers } from './exams.format'
import { examFormValuesOf } from './exams.form'
import type { ExamFormValues } from './exams.form'
import { examFormHasChanges, lockedFieldUpdates, planExamPatch, reopensRevealedWindow, turnsManual } from './exams.patch'
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
const EDIT_FIELDS = new Set([
  'lessonId',
  'type',
  'titleAr',
  'titleEn',
  'descriptionAr',
  'descriptionEn',
  'scheduledDate',
  'scheduledTime',
  'durationMinutes',
  'maxScore',
  'passScore',
  'weight',
  // MOD-09 phase 2: the online settings (on screen while the form says «online»).
  'delivery',
  'closesDate',
  'closesTime',
  'attemptsAllowed',
  'resultsRelease',
  'revealAnswers',
])

/** The exam or its class changed elsewhere (or the exam is gone): the edit form closes and the drawer re-reads it. */
const STALE_EDIT_CODES = ['class_closed', 'exam_not_found']

/**
 * A status action refused because the exam, its class or what the server knows about it changed since the drawer read
 * it: the drawer re-reads it. For an online exam that includes a student who has started meanwhile (`exam_has_attempts`,
 * and `exam_not_deletable` with its `attemptCount`) and a readiness that is no longer what the details listed
 * (`exam_not_ready` — a question back to draft, a window that closed).
 */
const STALE_ACTION_CODES = ['invalid_transition', 'exam_has_results', 'exam_not_deletable', 'class_closed', 'exam_not_found', 'exam_has_attempts', 'exam_not_ready']

/** The tabs of the drawer (API-119 needs `exams.read`, as API-114 does: whoever reads the exam reads its sheet). */
type DrawerTab = 'details' | 'questions' | 'attempts' | 'results'

/** The editors that report unsaved work: the edit form of the details tab, the question set of an online draft and the results sheet. */
type EditorPart = 'details' | 'questions' | 'results'

const NOTHING_UNSAVED: Readonly<Record<EditorPart, boolean>> = { details: false, questions: false, results: false }

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
    return { details: reporter('details'), questions: reporter('questions'), results: reporter('results') }
  }, [])
  // While the edit form, the question set or the results sheet holds unsaved work, Escape and a mask click must not drop it with the drawer.
  const unsaved = (editing && unsavedParts.details) || unsavedParts.questions || unsavedParts.results

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
  // An online exam's results change outside the results sheet — an attempt finishes, a key correction or a regrade
  // rewrites them — so the two online tabs that notice it also have the sheet read again (keeping its unsaved rows).
  const [resultsSignal, setResultsSignal] = useState(0)
  const reloadWithResults = useCallback(() => {
    setReloadTick((tick) => tick + 1)
    setResultsSignal((signal) => signal + 1)
  }, [])

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
      <ExamDetails
        exam={current}
        // An online draft lists what keeps it from being made available, with the way to where each is put right.
        onOpenQuestions={canReadResults ? () => setTab('questions') : undefined}
        onEdit={editability.editable ? () => setEditing(true) : undefined}
      />
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
      {exam ? (
        <Alert
          type="info"
          showIcon
          // An online exam's statuses mean something else: scheduled = available inside its window, published = results released (D-R151).
          title={t(exam.delivery === 'online' ? `examOnline.statusHint.${exam.status}` : `exams.drawer.statusHint.${exam.status}`)}
          style={{ marginBottom: 16 }}
          data-testid="exam-status-hint"
        />
      ) : null}

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
                // MOD-09 phase 2: an online exam has its questions and its attempts; a manual exam shows neither tab.
                ...(exam.delivery === 'online'
                  ? [
                      {
                        key: 'questions',
                        label: t('examOnline.tab'),
                        // A new editor session when the exam leaves or reaches draft (that decides whether the set is editable).
                        children: <ExamQuestionsTab key={`${exam.id}:${exam.status === 'draft'}`} exam={exam} onChanged={reloadWithResults} onUnsavedChange={reportUnsaved.questions} />,
                      },
                      { key: 'attempts', label: t('examAttempts.tab'), children: <ExamAttemptsTab key={exam.id} exam={exam} onChanged={reloadWithResults} /> },
                    ]
                  : []),
                {
                  key: 'results',
                  label: t('exams.drawer.tabs.results'),
                  // Re-read when the exam leaves or reaches draft here (that decides whether it takes results); publish
                  // and unpublish keep the sheet and its unsaved rows, and its «published» note follows `exam.status`.
                  children: (
                    <ExamResultsTab
                      key={`${exam.id}:${exam.status === 'draft'}`}
                      exam={exam}
                      onSaved={applyResults}
                      onExamStale={reload}
                      onUnsavedChange={reportUnsaved.results}
                      refreshSignal={resultsSignal}
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
          // `schedule` freezes the SAVED question set, and the exam leaving its draft starts the «الأسئلة» tab over.
          dropsUnsavedQuestions={pending === 'schedule' && unsavedParts.questions}
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

interface ExamDetailsProps {
  exam: Exam
  /** Opens the «الأسئلة» tab (absent when the tabs do not show). */
  onOpenQuestions?: () => void
  /** Opens the edit form (absent when the caller may not edit the exam). */
  onEdit?: () => void
}

function ExamDetails({ exam, onOpenQuestions, onEdit }: ExamDetailsProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const dash = '—'
  const zone = exam.timeZone
  // MOD-09 phase 2: an online exam shows its settings and the server's summary; a manual one none of it.
  const online = exam.delivery === 'online'
  const summary = online ? exam.online : null
  const notSet = <Typography.Text type="secondary">{t('examOnline.details.notSet')}</Typography.Text>

  return (
    <>
      {summary && exam.status === 'draft' ? <ExamReadiness problems={summary.problems} numbers={{ totalPoints: summary.totalPoints, maxScore: exam.maxScore }} onOpenQuestions={onOpenQuestions} onEdit={onEdit} /> : null}
      <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
        <Descriptions.Item label={t('exams.fields.class')}>
          <Space wrap>
            <Typography.Text strong>
              <bdi dir="ltr">{exam.class.code}</bdi>
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
        {online ? (
          <Descriptions.Item label={t('examOnline.details.delivery')}>
            <Tag color="geekblue" data-testid="exam-online-tag">
              {t('examOnline.delivery.tag')}
            </Tag>
          </Descriptions.Item>
        ) : null}
        <Descriptions.Item label={t('exams.fields.lesson')}>
          {exam.lesson ? (
            `${formatZonedDay(exam.lesson.startsAt, zone, language)} — ${localizedLabel(exam.lesson.title, language)}`
          ) : (
            <Typography.Text type="secondary">{t('exams.drawer.noLesson')}</Typography.Text>
          )}
        </Descriptions.Item>
        {/* For an online exam the date is when its window opens and the duration one attempt's time limit (D-R152). */}
        <Descriptions.Item label={online ? t('examOnline.details.opensAt') : t('exams.fields.scheduledAt')}>
          {exam.scheduledAt ? <ZonedAt iso={exam.scheduledAt} zone={zone} /> : online ? notSet : <Typography.Text type="secondary">{t('exams.drawer.noDate')}</Typography.Text>}
        </Descriptions.Item>
        {online ? <Descriptions.Item label={t('examOnline.details.closesAt')}>{exam.closesAt ? <ZonedAt iso={exam.closesAt} zone={zone} /> : notSet}</Descriptions.Item> : null}
        <Descriptions.Item label={online ? t('examOnline.details.attemptDuration') : t('exams.fields.durationMinutes')}>
          {exam.durationMinutes !== null ? t('exams.drawer.minutes', { count: exam.durationMinutes }) : online ? notSet : dash}
        </Descriptions.Item>
        {online ? <Descriptions.Item label={t('examOnline.details.attemptsAllowed')}>{t('examOnline.details.attemptsAllowedValue', { count: exam.attemptsAllowed })}</Descriptions.Item> : null}
        {online ? <Descriptions.Item label={t('examOnline.details.resultsRelease')}>{t(`examOnline.release.${exam.resultsRelease}`)}</Descriptions.Item> : null}
        {online ? <Descriptions.Item label={t('examOnline.details.revealAnswers')}>{t(exam.revealAnswers ? 'examOnline.details.revealYes' : 'examOnline.details.revealNo')}</Descriptions.Item> : null}
        {summary ? (
          <Descriptions.Item label={t('examOnline.details.questions')}>
            <ExamQuestionsSummary exam={exam} summary={summary} />
          </Descriptions.Item>
        ) : null}
        {summary ? (
          <Descriptions.Item label={t('examOnline.details.attempts')}>
            <Space wrap size={4} data-testid="exam-online-attempts">
              <span>{t('examOnline.details.startedBy', { count: summary.attempts.students })}</span>
              {summary.attempts.students > 0 ? <Tag color="processing">{t('examOnline.details.inProgress', { value: summary.attempts.inProgress })}</Tag> : null}
              {summary.attempts.students > 0 ? <Tag color="green">{t('examOnline.details.finished', { value: summary.attempts.finished })}</Tag> : null}
            </Space>
          </Descriptions.Item>
        ) : null}
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
            <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
              <div dir="ltr">{exam.description.en}</div>
            </Typography.Paragraph>
          </Descriptions.Item>
        ) : null}
        {/* The lifecycle instants read like every other drawer's (this device's zone); `timeZone` is the exam date's (API-113). */}
        {exam.publishedAt ? <Descriptions.Item label={t('exams.fields.publishedAt')}>{formatDateTime(exam.publishedAt, language)}</Descriptions.Item> : null}
        <Descriptions.Item label={t('exams.fields.createdAt')}>{formatDateTime(exam.createdAt, language)}</Descriptions.Item>
        <Descriptions.Item label={t('exams.fields.updatedAt')}>{formatDateTime(exam.updatedAt, language)}</Descriptions.Item>
      </Descriptions>
    </>
  )
}

/**
 * The linked questions of an online exam as the server counts them: how many, and their points against the maximum
 * score. Whether the two are equal is the server's verdict (`points_mismatch` among a draft's problems; an exam that
 * was made available had to be equal) — nothing is compared here.
 */
function ExamQuestionsSummary({ exam, summary }: { exam: Pick<Exam, 'status' | 'maxScore'>; summary: NonNullable<Exam['online']> }) {
  const { t } = useTranslation()
  const mismatch = summary.problems.includes('points_mismatch')
  return (
    <Space wrap size={4} data-testid="exam-online-questions">
      <span>{t('examOnline.details.questionCount', { count: summary.questionCount })}</span>
      {summary.questionCount > 0 ? <span>— {t('examOnline.details.points', { total: summary.totalPoints, max: exam.maxScore })}</span> : null}
      {summary.questionCount > 0 ? <Tag color={mismatch ? 'orange' : 'green'}>{t(mismatch ? 'examOnline.details.pointsMismatch' : 'examOnline.details.pointsMatch')}</Tag> : null}
    </Space>
  )
}

interface ExamReadinessProps {
  /** The server's list (`exam.online.problems`, or the `problems` of `exam_not_ready`). */
  problems: readonly string[]
  numbers: ReadinessNumbers
  onOpenQuestions?: () => void
  onEdit?: () => void
}

/** What keeps an online draft from being made available — the server's list at its clock — with where each is put right. */
function ExamReadiness({ problems, numbers, onOpenQuestions, onEdit }: ExamReadinessProps) {
  const { t } = useTranslation()
  if (problems.length === 0) return <Alert type="success" showIcon title={t('examOnline.readiness.ready')} style={{ marginBottom: 16 }} data-testid="exam-readiness" />
  const fixes = new Set(problems.map(readinessFixOf))
  return (
    <Alert
      type="warning"
      showIcon
      title={t('examOnline.readiness.title')}
      description={
        <>
          <ReadinessProblems problems={problems} numbers={numbers} withFix />
          {(fixes.has('questions') && onOpenQuestions) || (fixes.has('settings') && onEdit) ? (
            <Space wrap style={{ marginTop: 8 }}>
              {fixes.has('questions') && onOpenQuestions ? (
                <Button size="small" onClick={onOpenQuestions}>
                  {t('examOnline.readiness.openQuestions')}
                </Button>
              ) : null}
              {fixes.has('settings') && onEdit ? (
                <Button size="small" onClick={onEdit}>
                  {t('examOnline.readiness.openEdit')}
                </Button>
              ) : null}
            </Space>
          ) : null}
        </>
      }
      style={{ marginBottom: 16 }}
      data-testid="exam-readiness"
    />
  )
}

/** The readiness problems in words, one per line; `withFix` adds where each one is put right. */
function ReadinessProblems({ problems, numbers, withFix = false }: { problems: readonly string[]; numbers: ReadinessNumbers; withFix?: boolean }) {
  const { t } = useTranslation()
  return (
    <ul style={{ margin: 0, paddingInlineStart: 20 }}>
      {problems.map((problem) => {
        const fix = withFix ? readinessFixOf(problem) : null
        return (
          <li key={problem}>
            {readinessProblemText(t, problem, numbers)}
            {fix ? <Typography.Text type="secondary"> — {t(`examOnline.readiness.fix.${fix}`)}</Typography.Text> : null}
          </li>
        )
      })}
    </ul>
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
  /** The «الأسئلة» tab holds a question set that was not saved, and the action would start that tab over. */
  dropsUnsavedQuestions?: boolean
  /** The exam after a status change, or null after a deletion. */
  onDone: (exam: Exam | null) => void
  /** The exam changed elsewhere meanwhile: re-read it. */
  onStale: () => void
  onCancel: () => void
}

function ExamActionModal({ exam, action, dropsUnsavedQuestions = false, onDone, onStale, onCancel }: ExamActionModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ExamsFailure | null>(null)
  const name = examTitle(exam, language)
  // What the action means for an online exam is not what it means for a manual one (D-R151).
  const online = exam.delivery === 'online'

  const confirm = async () => {
    setBusy(true)
    setFailure(null)
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
      const described = describeExamsFailure(caught)
      setFailure(described)
      if (STALE_ACTION_CODES.some((code) => isExamsFailure(described, code))) onStale()
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
      <Typography.Paragraph>{t(online ? `examOnline.confirm.${action}` : `exams.confirm.${action}`)}</Typography.Paragraph>
      {dropsUnsavedQuestions ? <Alert type="warning" showIcon title={t('examOnline.confirm.unsavedQuestions')} style={{ marginBottom: 16 }} /> : null}
      {action !== 'delete' ? (
        <Form layout="vertical">
          <Form.Item label={t('exams.confirm.reason')} extra={t('exams.confirm.reasonAudit')} htmlFor="exam-status-reason">
            <Input.TextArea id="exam-status-reason" rows={2} maxLength={EXAM_STATUS_REASON_MAX_LENGTH} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} />
          </Form.Item>
        </Form>
      ) : null}
      {failure ? <ExamActionFailure exam={exam} failure={failure} /> : null}
    </Modal>
  )
}

/**
 * A refused action in words. `exam_not_ready` lists what keeps the online exam from being made available (the
 * server's problems, with its numbers); `exam_window_open` says when the window closes, in the exam's zone — named
 * when it is not this device's; everything else is the failure's message.
 */
function ExamActionFailure({ exam, failure }: { exam: Pick<Exam, 'timeZone'>; failure: ExamsFailure }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  if (failure.readiness?.problems.length) {
    return <Alert type="error" showIcon title={t('examOnline.errors.notReadyTitle')} description={<ReadinessProblems problems={failure.readiness.problems} numbers={failure.readiness} />} data-testid="exam-not-ready" />
  }
  const zoneNamed = Boolean(failure.windowClosesAt) && differsFromDevice(exam.timeZone)
  return (
    <Alert
      type="error"
      showIcon
      title={failureMessage(t, failure, { instant: (iso) => formatZonedDateTime(iso, exam.timeZone, language) })}
      description={zoneNamed ? <bdi dir="ltr">{exam.timeZone}</bdi> : undefined}
    />
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
 *
 * MOD-09 phase 2: before two saves the form asks first — one that turns an
 * online draft manual (the server unlinks its questions and drops its online
 * settings) and one that moves the closing later on an exam whose window has
 * closed and that reveals its answers (KI-130: a warning the server does not
 * give). `exam_locked` may now name several fields, each locked for its own
 * reason (lockedFieldMessageKey()): a student who started meanwhile fixes the
 * opening and the time limit, and so on — every refused field goes back to its
 * stored value with that reason, and the re-read locks them on screen.
 */
function ExamEditForm({ exam, maxScoreLocked, onSaved, onStale, onRefresh, onCancel, onUnsavedChange }: ExamEditFormProps) {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  // One question at a time: a second «save» while a confirmation is open asks nothing again.
  const asking = useRef(false)
  const context = useExamFormContext(form, exam.class.id, exam)
  const zone = context.zone.zone

  // The form left (saved, cancelled, stale, or the drawer closed) — nothing is held any more.
  useEffect(() => () => onUnsavedChange(false), [onUnsavedChange])

  const send = async (body: UpdateExamInput) => {
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
        form.setFields(lockedFieldUpdates(exam, failure.lockedFields, (field) => t(lockedFieldMessageKey(field, failure))))
        onRefresh()
      } else if (failure.field && EDIT_FIELDS.has(failure.field[0] ?? '')) form.setFields([{ name: failure.field, errors: [text] }])
      else message.error(text)
      setSaving(false)
    }
  }

  const save = (values: ExamFormValues) => {
    if (asking.current) return
    const body = planExamPatch(exam, values, zone)
    if (!body) {
      message.info(t('exams.drawer.nothingChanged'))
      onUnsavedChange(false)
      onCancel()
      return
    }
    // The two saves that ask first; they cannot meet (the delivery changes in a draft, a draft was never taken).
    const question = turnsManual(exam, body) ? 'toManual' : reopensRevealedWindow(exam, body, Date.now()) ? 'reopen' : null
    if (!question) {
      void send(body)
      return
    }
    const linked = exam.online?.questionCount ?? 0
    asking.current = true
    modal.confirm({
      title: t(`examOnline.${question}.title`),
      content: question === 'toManual' && linked > 0 ? `${t('examOnline.toManual.content')} ${t('examOnline.toManual.questions', { value: linked })}` : t(`examOnline.${question}.content`),
      okText: t(`examOnline.${question}.ok`),
      okButtonProps: { danger: true },
      cancelText: t(`examOnline.${question}.cancel`),
      // Without parameters: antd closes the dialog itself after the answer.
      onOk: () => {
        asking.current = false
        void send(body)
      },
      onCancel: () => {
        asking.current = false
      },
    })
  }

  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={examFormValuesOf(exam)}
      // Compared with the exam as loaded on every change, so a change changed back holds nothing.
      onValuesChange={(_changed, values) => onUnsavedChange(examFormHasChanges(exam, values as ExamFormValues, zone))}
      onFinish={(values) => save(values as ExamFormValues)}
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
