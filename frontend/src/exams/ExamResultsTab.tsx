// The «results» tab of the exam drawer (J-F45): the sheet of API-119 — one row
// per student with their enrollment status and result — and, for a holder of
// `exams.grade` while the server says `recordable`, an editor that saves the
// changed rows in ONE PUT (API-120), on the pattern of the attendance sheet
// (attendance/AttendanceSheetTab.tsx). Each row is sent as the whole new state
// of that result (`scored` with a score in 0..maxScore, `absent` or `excused`
// without one; an emptied feedback clears it); nothing is sent when no row
// changed; the screen shows the server's answer only (no optimistic rows, no
// count of its own), then the exam's counts follow it in the drawer and the
// list. A student whose enrollment is not active or completed (withdrawn after
// the exam…) stays listed read-only — the server refuses them with
// `not_enrolled`. When each result was written is shown in the exam's
// `timeZone` (D-R41). The editor reports through `onUnsavedChange` whether a
// row differs from the server's result — the save would send it — so the
// drawer keeps it on Escape, a mask click, the close button, a browser
// back/forward and a reload (the KI-058 guard); a row changed back holds
// nothing, a read-only sheet never holds, and the saved answer starts a clean
// session.
// Since MOD-09 phase 2 (D-R160) the same sheet serves an ONLINE exam
// (`sheet.delivery`): the result of a student who took it is their counted
// attempt, written by the server, and is not typed over — a note says so, every
// result names its source, and a row whose student has an attempt
// (`attemptCount > 0`) is read-only with the reason and never part of the PUT;
// the sheet records the students who have no attempt (absent, excused, a
// make-up on paper). A student who starts an attempt after the sheet was read
// makes the server refuse the whole batch (409 `result_from_attempt`): the
// sheet names and marks those rows, drops their changes, keeps the others and
// reads itself again in the same session, so the rows lock. A manual exam
// shows none of this: its sheet is as it was.
import { ReloadOutlined, UndoOutlined } from '@ant-design/icons'
import { Alert, App, Button, Flex, Input, InputNumber, Popconfirm, Radio, Skeleton, Space, Table, Tag, Typography, theme } from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EXAM_RESULT_STATUSES, RESULTS_BATCH_MAX, RESULT_FEEDBACK_MAX_LENGTH, recordExamResults } from '../api/examResults'
import type { ExamResultItem, ExamResultStatus, ExamResultsSheet } from '../api/examResults'
import type { Exam, ExamStatus } from '../api/exams'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { describeSheetFailure } from './examAttempts.errors'
import { ResultSourceTag } from './examAttempts.parts'
import { changedItems, currentDraft, draftProblem, hasAttempt, isBatchTooLarge, isEditableItem, isRecordableItem, planResultsSave, withStatus, withoutDrafts } from './examResults.changes'
import type { ResultDraft } from './examResults.changes'
import { describeResultsFailure, failureMessage } from './exams.errors'
import { RESULT_STATUS_COLORS } from './exams.format'
import { useExamResults } from './useExamResults'

interface ExamResultsTabProps {
  /** The exam's id, its zone for the times the sheet shows, and its status as the drawer shows it. */
  exam: Pick<Exam, 'id' | 'timeZone' | 'status'>
  /** The sheet the server answered after a save: its counts update the exam in the drawer and in the list. */
  onSaved: (sheet: ExamResultsSheet) => void
  /** The exam changed elsewhere (back to draft, its class cancelled, gone): the drawer re-reads it. */
  onExamStale: () => void
  /** Whether a row holds a change the save would send: reported on every change, false once saved or left. */
  onUnsavedChange?: (unsaved: boolean) => void
  /**
   * Bumped by the drawer when the results changed outside this sheet (an online exam's attempt finished, its key was
   * corrected, it was regraded): the sheet is read again in the same session, so its unsaved rows stay.
   */
  refreshSignal?: number
}

export function ExamResultsTab({ exam, onSaved, onExamStale, onUnsavedChange, refreshSignal = 0 }: ExamResultsTabProps) {
  const { t } = useTranslation()
  const canGrade = useAuth().hasPermission('exams.grade')
  const { sheet, error, loading, version, revision, reload, refresh, replace } = useExamResults(exam.id)
  const failure = error ? describeResultsFailure(error) : null

  // The signal of the first render is the one the first read already answers; only a later bump reads again.
  const seenSignal = useRef(refreshSignal)
  useEffect(() => {
    if (seenSignal.current === refreshSignal) return
    seenSignal.current = refreshSignal
    refresh()
  }, [refreshSignal, refresh])

  // The exam's status from the newest fact (V2 D1): publish and unpublish in the drawer keep this tab, its sheet and
  // its unsaved rows, so after one the sheet's `examStatus` is older than the drawer's status; a sheet read or saved
  // later is the newer one again. Kept per sheet the server answered (`revision`: read, saved, or refreshed in the
  // same session) — React's "adjust state when an input changes".
  const [statusAtRead, setStatusAtRead] = useState({ revision, status: exam.status })
  if (statusAtRead.revision !== revision) setStatusAtRead({ revision, status: exam.status })
  const examStatus: ExamStatus = sheet && statusAtRead.status === exam.status ? sheet.examStatus : exam.status

  return (
    <div data-testid="exam-results-sheet">
      {failure ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={reload}>
              {t('exams.results.reload')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {!sheet && !failure ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
      {sheet ? (
        <ResultsEditor
          // One edit session per server version of the sheet (KI-049): a save or a reload starts from the server's state.
          key={`${sheet.examId}:${version}`}
          sheet={sheet}
          examStatus={examStatus}
          timeZone={exam.timeZone}
          canGrade={canGrade}
          loading={loading}
          onSaved={(saved) => {
            replace(saved)
            onSaved(saved)
          }}
          onStale={() => {
            reload()
            onExamStale()
          }}
          onGone={onExamStale}
          onReload={reload}
          onRefresh={refresh}
          onUnsavedChange={onUnsavedChange}
        />
      ) : null}
    </div>
  )
}

interface ResultsEditorProps {
  sheet: ExamResultsSheet
  /** The exam's status from the newest fact (the drawer's after a status action, else the sheet's). */
  examStatus: ExamStatus
  /** The exam's zone (D-R41). */
  timeZone: string
  canGrade: boolean
  loading: boolean
  onSaved: (sheet: ExamResultsSheet) => void
  onStale: () => void
  onGone: () => void
  /** Reads the sheet again in a NEW session: the unsaved rows go. */
  onReload: () => void
  /** Reads the sheet again in THIS session: the unsaved rows stay (after `result_from_attempt`). */
  onRefresh: () => void
  onUnsavedChange?: (unsaved: boolean) => void
}

function ResultsEditor({ sheet, examStatus, timeZone, canGrade, loading, onSaved, onStale, onGone, onReload, onRefresh, onUnsavedChange }: ResultsEditorProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const [drafts, setDrafts] = useState<ReadonlyMap<string, ResultDraft>>(() => new Map())
  const [refused, setRefused] = useState<ReadonlySet<string>>(() => new Set())
  const [showProblems, setShowProblems] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const editable = canGrade && sheet.recordable
  // An online exam: the results of those who took it are their attempts' (D-R160); a manual sheet shows none of that.
  const online = sheet.delivery === 'online'
  const changed = changedItems(sheet.items, drafts)
  const changedIds = new Set(changed.map((item) => item.student.id))
  const problems = new Map(
    changed.flatMap((item) => {
      const problem = draftProblem(currentDraft(item, drafts), sheet.maxScore)
      return problem ? [[item.student.id, problem] as const] : []
    }),
  )
  const nameOf = (studentId: string) => sheet.items.find((item) => item.student.id === studentId)?.student.fullName ?? studentId

  // Rows the save would send are unsaved work — compared with the server's results, so a row changed back holds
  // nothing; a read-only sheet never holds. False when the editor leaves: the saved answer (or a reload) starts a new
  // session, keyed by the sheet's version (KI-049).
  const unsaved = editable && planResultsSave(sheet.items, drafts) !== null
  useEffect(() => {
    onUnsavedChange?.(unsaved)
    return () => onUnsavedChange?.(false)
  }, [unsaved, onUnsavedChange])

  const update = (studentId: string, draft: ResultDraft) => setDrafts((previous) => new Map(previous).set(studentId, draft))
  const revert = (studentId: string) =>
    setDrafts((previous) => {
      const next = new Map(previous)
      next.delete(studentId)
      return next
    })

  const save = async () => {
    const body = planResultsSave(sheet.items, drafts)
    if (!body) {
      message.info(t('exams.results.nothingChanged'))
      return
    }
    if (problems.size > 0) {
      setShowProblems(true)
      setError(t('exams.results.validation.fixRows'))
      return
    }
    if (isBatchTooLarge(body)) {
      setError(t('exams.results.validation.tooMany', { max: RESULTS_BATCH_MAX }))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await recordExamResults(sheet.examId, body)
      message.success(t('exams.results.saved'))
      // The parent replaces the sheet with the server's answer, which remounts this editor (a new session).
      onSaved(saved)
    } catch (caught) {
      setSaving(false)
      const failure = describeSheetFailure(caught)
      if (failure.next === 'refused') {
        const ids = failure.studentIds ?? []
        setRefused(new Set(ids))
        setError(failureMessage(t, { ...failure, params: { ...failure.params, names: ids.map(nameOf).join(t('exams.errors.listSeparator')) } }))
        if (failure.fromAttempt) {
          // These students started an attempt after the sheet was read: no retry can record them here, so their
          // changes go, the other rows stay as typed, and the sheet is read again in this session — their rows lock.
          setDrafts((previous) => withoutDrafts(previous, ids))
          onRefresh()
        }
        return
      }
      const text = failureMessage(t, failure)
      if (failure.next === 'stale') {
        message.error(text)
        onStale()
        return
      }
      if (failure.next === 'gone') {
        message.error(text)
        onGone()
        return
      }
      setError(text)
    }
  }

  const statusTag = (status: ExamResultStatus) => <Tag color={RESULT_STATUS_COLORS[status]}>{t(`exams.results.status.${status}`)}</Tag>

  const columns: TableProps<ExamResultItem>['columns'] = [
    {
      title: t('exams.results.columns.student'),
      key: 'student',
      render: (_, item) => (
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>{item.student.fullName}</Typography.Text>
          {item.student.displayName && item.student.displayName !== item.student.fullName ? <Typography.Text type="secondary">{item.student.displayName}</Typography.Text> : null}
          <Space size={4} wrap>
            <Tag color={isRecordableItem(item) ? undefined : 'default'}>{t(`exams.results.enrollment.${item.enrollmentStatus ?? 'none'}`)}</Tag>
            {item.student.deletedAt ? <Tag color="volcano">{t('exams.results.deleted')}</Tag> : null}
            {/* An online exam: where the result came from — the student's counted attempt, or this sheet. */}
            {online && item.result ? <ResultSourceTag source={item.result.source} /> : null}
            {canGrade && sheet.recordable && !isRecordableItem(item) ? <Tag>{t('exams.results.readOnlyRow')}</Tag> : null}
            {refused.has(item.student.id) ? <Tag color="red">{t('exams.results.refusedRow')}</Tag> : null}
          </Space>
          {hasAttempt(item) ? (
            // Why the row takes no entry: the server refuses one for a student who has an attempt (D-R160). It wraps
            // within the name's width — the table sizes its columns to their content, and a long line would push
            // the other columns out of the drawer.
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', maxWidth: 200 }}>
              {t('examAttempts.sheet.lockedRow')}
            </Typography.Text>
          ) : null}
          {item.result ? (
            // Who wrote the result last, and when — under the name, so the table fits the drawer.
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {item.result.source === 'online' ? t('examAttempts.sheet.recordedByServer') : t('exams.results.recordedBy', { name: item.result.recordedBy?.fullName ?? '—' })}
              <br />
              {formatZonedDateTime(item.result.updatedAt, timeZone, language)}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: t('exams.results.columns.status'),
      key: 'status',
      render: (_, item) => {
        const draft = currentDraft(item, drafts)
        if (!editable || !isEditableItem(item)) return item.result ? statusTag(item.result.status) : <Typography.Text type="secondary">{t('exams.results.notRecorded')}</Typography.Text>
        return (
          <Radio.Group
            // One radio group per student: a shared generated name would make the whole table one group.
            name={`exam-result-status-${item.student.id}`}
            optionType="button"
            buttonStyle="solid"
            size="small"
            value={draft.status}
            disabled={saving}
            onChange={(event) => update(item.student.id, withStatus(draft, event.target.value as ExamResultStatus))}
            options={EXAM_RESULT_STATUSES.map((status) => ({ value: status, label: t(`exams.results.status.${status}`) }))}
            aria-label={`${t('exams.results.columns.status')}: ${item.student.fullName}`}
          />
        )
      },
    },
    {
      title: t('exams.results.columns.score', { max: sheet.maxScore }),
      key: 'score',
      render: (_, item) => {
        const draft = currentDraft(item, drafts)
        if (!editable || !isEditableItem(item)) return item.result?.score !== null && item.result?.score !== undefined ? <span dir="ltr">{item.result.score}</span> : '—'
        const problem = showProblems ? problems.get(item.student.id) : undefined
        const invalid = problem === 'score_required' || problem === 'score_invalid'
        return (
          <Space orientation="vertical" size={0}>
            {/* No min/max: antd would clamp an out-of-range score on blur — the row says what is wrong instead. */}
            <InputNumber
              size="small"
              value={draft.score}
              disabled={saving || draft.status !== 'scored'}
              status={invalid ? 'error' : undefined}
              onChange={(value) => update(item.student.id, { ...draft, score: typeof value === 'number' ? value : null })}
              aria-label={`${t('exams.results.columns.scoreLabel')}: ${item.student.fullName}`}
              style={{ width: 96 }}
            />
            {invalid ? (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                {problem === 'score_required' ? t('exams.results.validation.scoreRequired') : t('exams.results.validation.score', { max: sheet.maxScore })}
              </Typography.Text>
            ) : null}
          </Space>
        )
      },
    },
    {
      title: t('exams.results.columns.feedback'),
      key: 'feedback',
      render: (_, item) => {
        const draft = currentDraft(item, drafts)
        if (!editable || !isEditableItem(item)) return item.result?.feedback ? <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{item.result.feedback}</Typography.Text> : '—'
        const invalid = showProblems && problems.get(item.student.id) === 'feedback_too_long'
        return (
          <Space orientation="vertical" size={0}>
            <Input
              size="small"
              maxLength={RESULT_FEEDBACK_MAX_LENGTH}
              value={draft.feedback}
              disabled={saving}
              status={invalid ? 'error' : undefined}
              placeholder={t('exams.results.feedbackPlaceholder')}
              onChange={(event) => update(item.student.id, { ...draft, feedback: event.target.value })}
              aria-label={`${t('exams.results.columns.feedback')}: ${item.student.fullName}`}
              style={{ minWidth: 150 }}
            />
            {invalid ? (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                {t('exams.results.validation.feedbackTooLong', { max: RESULT_FEEDBACK_MAX_LENGTH })}
              </Typography.Text>
            ) : null}
          </Space>
        )
      },
    },
  ]
  if (editable) {
    columns.push({
      title: t('common.actions'),
      key: 'actions',
      render: (_, item) =>
        changedIds.has(item.student.id) ? (
          <Button size="small" type="link" icon={<UndoOutlined />} disabled={saving} onClick={() => revert(item.student.id)} aria-label={`${t('exams.results.revert')}: ${item.student.fullName}`}>
            {t('exams.results.revert')}
          </Button>
        ) : null,
    })
  }

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Space wrap>
          <Tag>{t('exams.results.recorded', { count: sheet.counts.students })}</Tag>
          {EXAM_RESULT_STATUSES.map((status) => (
            <Tag key={status} color={RESULT_STATUS_COLORS[status]}>{`${t(`exams.results.status.${status}`)}: ${sheet.counts[status]}`}</Tag>
          ))}
        </Space>
        <Typography.Text type="secondary">
          {t('exams.results.maxScore')} <span dir="ltr">{sheet.maxScore}</span>
        </Typography.Text>
      </Flex>

      {online ? <Alert type="info" showIcon title={t('examAttempts.sheet.note')} style={{ marginBottom: 12 }} data-testid="online-sheet-note" /> : null}
      {!sheet.recordable && sheet.closedReason ? <Alert type="warning" showIcon title={t(`exams.results.closed.${sheet.closedReason}`)} style={{ marginBottom: 12 }} /> : null}
      {sheet.recordable && !canGrade ? <Alert type="info" showIcon title={t('exams.results.readOnly')} style={{ marginBottom: 12 }} /> : null}
      {editable && examStatus === 'published' ? <Alert type="info" showIcon title={t('exams.results.publishedNote')} style={{ marginBottom: 12 }} /> : null}
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} /> : null}

      <Table<ExamResultItem>
        rowKey={(item) => item.student.id}
        columns={columns}
        dataSource={sheet.items}
        loading={loading}
        pagination={false}
        size="small"
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('exams.results.empty') }}
        onRow={(item) => ({ style: refused.has(item.student.id) ? { background: token.colorErrorBg } : undefined })}
      />

      {editable ? (
        <Flex justify="space-between" align="center" wrap gap={8} style={{ marginTop: 12 }}>
          <Typography.Text type="secondary">{changed.length > 0 ? t('exams.results.unsaved', { count: changed.length }) : t('exams.results.noChanges')}</Typography.Text>
          <Space wrap>
            {changed.length > 0 ? (
              <Popconfirm title={t('exams.results.reloadConfirm')} okText={t('exams.results.reload')} cancelText={t('common.cancel')} onConfirm={onReload}>
                <Button icon={<ReloadOutlined />} disabled={saving}>
                  {t('exams.results.reload')}
                </Button>
              </Popconfirm>
            ) : (
              <Button icon={<ReloadOutlined />} disabled={saving} onClick={onReload}>
                {t('exams.results.reload')}
              </Button>
            )}
            <Button type="primary" loading={saving} disabled={changed.length === 0} onClick={() => void save()}>
              {t('exams.results.save')}
            </Button>
          </Space>
        </Flex>
      ) : (
        <Flex justify="flex-end" style={{ marginTop: 12 }}>
          <Button icon={<ReloadOutlined />} onClick={onReload}>
            {t('exams.results.reload')}
          </Button>
        </Flex>
      )}
    </>
  )
}
