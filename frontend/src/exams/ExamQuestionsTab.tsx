// The «الأسئلة» tab of the exam drawer (MOD-09 phase 2 — roadmap §4r, OEX-T07):
// the questions of an ONLINE exam, read from API-270 when the tab mounts (the
// drawer mounts it for an online exam only and remounts it when the exam
// leaves or reaches draft). The server decides which of three views it is:
//
//   - a draft the caller may compose (`editable`, with `exams.manage` AND
//     `questions.manage`): an editor of the ordered set — each row its
//     position, prompt, type, bank, its status when the bank question is not
//     ready any more, and its points in this exam; move up / down, remove, and
//     «إضافة أسئلة» (QuestionPickerModal: ready questions of a bank). A running
//     line adds the points up against the exam's maximum score — a sum of the
//     editor's own inputs in whole hundredths, never a grade — and says when
//     they differ, because the exam cannot be made available until they are
//     equal. «حفظ الأسئلة» sends ONE PUT (API-271) with the whole ordered
//     list, only when it differs from the saved one; then the tab shows the
//     server's answer and the drawer re-reads the exam (`onChanged`). Rows the
//     server refuses (`question_not_found`, `question_not_ready`, a repeated
//     one) are marked and nothing is written; an exam that is no longer a
//     draft, or whose class was cancelled, is re-read;
//   - the same draft without the two keys, or of a cancelled class: the same
//     list, read-only, with the reason;
//   - an exam that was made available (`frozen`): the frozen copies the
//     attempts are served and graded from — every question with its options
//     and THE KEY marked, its points, its explanation and the history of its
//     key's corrections (when and why: who is an id, so no name is invented) —
//     and, for a holder of `exams.grade`, «تصحيح المفتاح» (CorrectKeyModal —
//     API-272), whose counts the tab shows before it re-reads.
//
// CH-0376: the draft editor adds a question in one of two ways — «اختيار من بنك الأسئلة» (the picker above) or
// «كتابة سؤال جديد»: the bank page's QuestionEditor in its `forExam` mode, whose question is kept in the bank of the
// exam's course (courseQuestionBank(): «أسئلة <الدورة>», created when the course has none) and appended to the list
// like a picked one. With no question yet, the two ways are shown as two cards.
//
// «معاينة كطالب» (ExamPreviewModal) is there in every view: the SAVED questions
// as a learner will see them, without the key — so it waits for a save while
// the editor differs. While the editor holds a set that differs from the saved
// one, or the key dialog holds a typed reason, the tab reports it
// (`onUnsavedChange`), so the drawer keeps it on Escape, a mask click, its
// close button, a browser back and a reload; false after a save and on unmount.
import { ArrowDownOutlined, ArrowUpOutlined, CheckCircleFilled, DatabaseOutlined, DeleteOutlined, EditOutlined, EyeOutlined, KeyOutlined, ReloadOutlined, SaveOutlined, UndoOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Col, Empty, Flex, InputNumber, Popconfirm, Row, Skeleton, Space, Tag, Tooltip, Typography, theme } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { EXAM_QUESTIONS_MAX, getExamQuestions, replaceExamQuestions } from '../api/examQuestions'
import type { ExamQuestionItem, ExamQuestions, KeyCorrectionResult } from '../api/examQuestions'
import type { Exam } from '../api/exams'
import type { QuestionBank } from '../api/questionBanks'
import type { ScheduleCourse } from '../api/timetable'
import { QUESTION_POINTS_LIMIT, QUESTION_POINTS_MIN } from '../api/questionBanks'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { QuestionEditor } from '../questions/QuestionEditor'
import { formatDateTime, localizedLabel } from '../users/users.format'
import { CorrectKeyModal } from './CorrectKeyModal'
import { ExamPreviewModal } from './ExamPreviewModal'
import { QuestionPickerModal } from './QuestionPickerModal'
import { describeQuestionSetFailure } from './examQuestions.errors'
import type { ExamQuestionsFailure, RefusedRowReason } from './examQuestions.errors'
import { addQuestions, formatHundredths, moveRow, planQuestionsSave, removeRow, roomLeft, rowsOf, setRowPoints, totalHundredths, totalMatchesMaxScore } from './examQuestions.set'
import type { QuestionRow, RowProblem } from './examQuestions.set'
import { courseQuestionBank } from './courseQuestionBank'
import { answerChoicesOf } from './examQuestions.view'
import { describeExamsFailure, failureMessage } from './exams.errors'
import { examTitle } from './exams.format'
import { isClassFrozenForExams } from './exams.status'

export interface ExamQuestionsTabProps {
  /** An online exam (the drawer mounts the tab for `delivery === 'online'` only). */
  exam: Exam
  /** The question set or a key changed on the server: the drawer re-reads the exam (its `online` summary follows). */
  onChanged: () => void
  /** True while the editor holds a question set that differs from the saved one. */
  onUnsavedChange: (unsaved: boolean) => void
}

interface TabState {
  /** The request the state answers (`examId:tick`). */
  key: string
  data: ExamQuestions | null
  failure: ExamQuestionsFailure | null
  /** Bumped by every set the server answers (read or saved): the editor is keyed by it, so each session starts from the server's state. */
  version: number
}

/** What the last key correction did, in the server's counts. */
interface Outcome {
  type: 'success' | 'info'
  text: string
}

export function ExamQuestionsTab({ exam, onChanged, onUnsavedChange }: ExamQuestionsTabProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  // API-271 needs both keys; API-272 needs `exams.grade` — the server stays the boundary.
  const canEditSet = hasPermission('exams.manage') && hasPermission('questions.manage')
  const canGrade = hasPermission('exams.grade')

  const [tick, setTick] = useState(0)
  const requestKey = `${exam.id}:${tick}`
  const [state, setState] = useState<TabState>({ key: '', data: null, failure: null, version: 0 })
  const [editorUnsaved, setEditorUnsaved] = useState(false)
  const [keyDirty, setKeyDirty] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [correcting, setCorrecting] = useState<{ item: ExamQuestionItem; number: number } | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getExamQuestions(exam.id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState((previous) => ({ key: requestKey, data, failure: null, version: previous.version + 1 }))
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, key: requestKey, failure: describeQuestionSetFailure(error) }))
      })
    return () => controller.abort()
  }, [exam.id, requestKey])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const loading = state.key !== requestKey
  const failure = loading ? null : state.failure
  const { data, version } = state

  // The editor's set and the key dialog's reason are the tab's unsaved work: the drawer keeps both.
  const unsaved = editorUnsaved || keyDirty
  useEffect(() => {
    onUnsavedChange(unsaved)
  }, [unsaved, onUnsavedChange])
  useEffect(() => () => onUnsavedChange(false), [onUnsavedChange])

  /** The exam changed elsewhere (or is gone): the tab and the drawer both re-read it. */
  const refreshAll = () => {
    reload()
    onChanged()
  }

  const applyCorrection = (result: KeyCorrectionResult, number: number) => {
    setCorrecting(null)
    setOutcome(
      result.changed
        ? {
            type: 'success',
            text: t('examOnline.key.done', {
              number,
              attempts: t('examOnline.key.regraded', { count: result.regrade.attempts }),
              changed: t('examOnline.key.changedAttempts', { count: result.regrade.changedAttempts }),
              results: t('examOnline.key.changedResults', { count: result.regrade.changedResults }),
            }),
          }
        : { type: 'info', text: t('examOnline.key.unchanged', { number }) },
    )
    // The tab shows the question as the server holds it now, and the drawer's counts follow.
    refreshAll()
  }

  const previewButton = (waitsForSave: boolean) => {
    const button = (
      <Button icon={<EyeOutlined />} onClick={() => setPreviewing(true)} disabled={waitsForSave || !data} aria-describedby={waitsForSave ? 'exam-preview-hint' : undefined}>
        {t('examOnline.preview.open')}
      </Button>
    )
    // A disabled button swallows the pointer events, so the hint sits on a wrapper.
    return waitsForSave ? (
      <Tooltip title={t('examOnline.preview.saveFirst')}>
        <span style={{ display: 'inline-block' }}>{button}</span>
      </Tooltip>
    ) : (
      button
    )
  }

  const reloadButton = (
    <Button icon={<ReloadOutlined />} onClick={reload} loading={loading && data !== null}>
      {t('examOnline.questions.refresh')}
    </Button>
  )

  return (
    <div data-testid="exam-questions-tab">
      {failure ? (
        <Alert
          type="error"
          showIcon
          title={t('examOnline.questions.loadError')}
          description={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={reload}>
              {t('examOnline.questions.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {!data && !failure ? <Skeleton active paragraph={{ rows: 6 }} data-testid="exam-questions-loading" /> : null}

      {outcome ? <Alert type={outcome.type} showIcon title={outcome.text} closable={{ onClose: () => setOutcome(null) }} style={{ marginBottom: 12 }} data-testid="key-correction-outcome" /> : null}

      {data && data.delivery !== 'online' ? <Alert type="info" showIcon title={t('examOnline.errors.exam_not_online')} /> : null}

      {data && data.delivery === 'online' && data.frozen ? (
        <FrozenQuestions
          data={data}
          // A cancelled class takes no correction (`class_closed`).
          correctable={canGrade && !isClassFrozenForExams(exam.class.status)}
          classCancelled={canGrade && isClassFrozenForExams(exam.class.status)}
          toolbar={
            <Space wrap>
              {previewButton(false)}
              {reloadButton}
            </Space>
          }
          onCorrect={(item, number) => setCorrecting({ item, number })}
        />
      ) : null}

      {data && data.delivery === 'online' && !data.frozen && data.editable && canEditSet ? (
        <QuestionSetEditor
          // One edit session per set the server answered (KI-049): a save or a re-read starts from the server's state.
          key={`${data.examId}:${version}`}
          data={data}
          maxScore={exam.maxScore}
          course={exam.class.course}
          reloading={loading}
          previewButton={previewButton}
          onSaved={(saved) => {
            setState((previous) => ({ ...previous, data: saved, failure: null, version: previous.version + 1 }))
            onChanged()
          }}
          onStale={refreshAll}
          onReload={reload}
          onUnsavedChange={setEditorUnsaved}
        />
      ) : null}

      {data && data.delivery === 'online' && !data.frozen && !(data.editable && canEditSet) ? (
        <QuestionSetList
          data={data}
          maxScore={exam.maxScore}
          // The class rule first: without it the two keys would not help either.
          reason={data.editable ? t('examOnline.editor.readOnlyKeys') : t('examOnline.editor.readOnlyClass')}
          toolbar={
            <Space wrap>
              {previewButton(false)}
              {reloadButton}
            </Space>
          }
        />
      ) : null}

      {previewing && data ? <ExamPreviewModal title={examTitle(exam, language)} items={data.items} onClose={() => setPreviewing(false)} /> : null}

      {correcting ? (
        <CorrectKeyModal
          // Mounted per question, so the reason never carries over to the next one (KI-049).
          key={correcting.item.id}
          examId={exam.id}
          item={correcting.item}
          number={correcting.number}
          onDone={(result) => applyCorrection(result, correcting.number)}
          onStale={(text) => {
            setCorrecting(null)
            message.error(text)
            refreshAll()
          }}
          onCancel={() => setCorrecting(null)}
          onDirtyChange={setKeyDirty}
        />
      ) : null}
    </div>
  )
}

// --- Shared pieces -----------------------------------------------------------

/** «مجموع النقاط X من Y» with whether the two are equal; `matches` null = no question to add up. */
function PointsTotal({ total, max, matches }: { total: string; max: number; matches: boolean | null }) {
  const { t } = useTranslation()
  return (
    <Space wrap size={4} data-testid="exam-questions-total">
      <Typography.Text strong>{t('examOnline.editor.total', { total, max })}</Typography.Text>
      {matches === null ? null : <Tag color={matches ? 'green' : 'orange'}>{t(matches ? 'examOnline.editor.totalMatch' : 'examOnline.editor.totalMismatch')}</Tag>}
    </Space>
  )
}

interface SetRowProps {
  row: QuestionRow
  /** Its position, 1 first. */
  number: number
  /** Marked after the server refused the whole set because of this row. */
  refused?: RefusedRowReason
  /** The points: a field in the editor, the number otherwise. */
  points: ReactNode
  /** Move and remove (the editor only). */
  actions?: ReactNode
  /** What is wrong with the row's points. */
  problem?: string
}

/** One question of a draft's set: position, type, bank, the bank question's status when it is not ready, and the prompt. */
function SetRow({ row, number, refused, points, actions, problem }: SetRowProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { token } = theme.useToken()
  const notReady = row.status !== null && row.status !== 'ready'
  return (
    <div
      role="listitem"
      data-testid="exam-question-row"
      data-refused={refused}
      style={{
        border: `1px solid ${refused ? token.colorError : token.colorBorderSecondary}`,
        background: refused ? token.colorErrorBg : undefined,
        borderRadius: token.borderRadius,
        padding: 12,
      }}
    >
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Space size={4} wrap>
          <Typography.Text strong>{t('examOnline.questions.question', { number })}</Typography.Text>
          <Tag>{t(`examOnline.types.${row.type}`)}</Tag>
          {notReady ? <Tag color="orange">{t(`examOnline.questionStatus.${row.status}`)}</Tag> : null}
          {row.added ? <Tag color="blue">{t('examOnline.editor.newRow')}</Tag> : null}
          {refused ? <Tag color="red">{t(`examOnline.editor.refused.${refused}`)}</Tag> : null}
        </Space>
        <Space size={4} wrap>
          {points}
          {actions}
        </Space>
      </Flex>
      {/* A plain element: antd Typography's RTL class would override dir="auto". Long prompts fold to three lines; the title holds the whole text. */}
      <div
        dir="auto"
        title={localizedLabel(row.prompt, language)}
        style={{ margin: '8px 0 4px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
      >
        {localizedLabel(row.prompt, language)}
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('examOnline.questions.bank', { name: localizedLabel(row.bank.name, language) })}
      </Typography.Text>
      {notReady ? (
        <Typography.Text type="warning" style={{ display: 'block', fontSize: 12 }}>
          {t('examOnline.editor.notReady', { status: t(`examOnline.questionStatus.${row.status}`) })}
        </Typography.Text>
      ) : null}
      {problem ? (
        <Typography.Text type="danger" style={{ display: 'block', fontSize: 12 }}>
          {problem}
        </Typography.Text>
      ) : null}
    </div>
  )
}

// --- A draft the caller may not compose ---------------------------------------

function QuestionSetList({ data, maxScore, reason, toolbar }: { data: ExamQuestions; maxScore: number; reason: string; toolbar: ReactNode }) {
  const { t } = useTranslation()
  const rows = rowsOf(data.items)
  return (
    <Flex vertical gap={12}>
      <Alert type="info" showIcon title={reason} />
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Space wrap size={8}>
          <Tag>{t('examOnline.editor.count', { value: rows.length, max: EXAM_QUESTIONS_MAX })}</Tag>
          {/* The server's own sum and its verdict (`points_mismatch`): nothing is added up for a list nobody edits. */}
          <PointsTotal total={String(data.totalPoints)} max={maxScore} matches={rows.length === 0 ? null : !data.problems.includes('points_mismatch')} />
        </Space>
        {toolbar}
      </Flex>
      {rows.length === 0 ? <Empty description={t('examOnline.frozen.empty')} /> : null}
      <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row, index) => (
          <SetRow key={row.questionId} row={row} number={index + 1} points={<Tag>{t('examOnline.questions.points', { points: row.points })}</Tag>} />
        ))}
      </div>
    </Flex>
  )
}

// --- The editor of a draft's set (`exams.manage` + `questions.manage`) ---------

interface QuestionSetEditorProps {
  data: ExamQuestions
  /** The exam's maximum score as the drawer holds it (the «Y» of the total). */
  maxScore: number
  /** The exam's course: a question written here is kept in its bank (CH-0376). */
  course: ScheduleCourse
  /** A re-read is on its way. */
  reloading: boolean
  /** «معاينة كطالب»: it shows the SAVED set, so it waits for a save while the rows differ. */
  previewButton: (waitsForSave: boolean) => ReactNode
  /** The set the server answered after the save. */
  onSaved: (saved: ExamQuestions) => void
  /** The exam changed elsewhere (no longer a draft, its class cancelled, gone): re-read the tab and the exam. */
  onStale: () => void
  onReload: () => void
  onUnsavedChange: (unsaved: boolean) => void
}

function QuestionSetEditor({ data, maxScore, course, reloading, previewButton, onSaved, onStale, onReload, onUnsavedChange }: QuestionSetEditorProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [rows, setRows] = useState<QuestionRow[]>(() => rowsOf(data.items))
  const [refused, setRefused] = useState<ReadonlyMap<string, RefusedRowReason>>(() => new Map())
  const [showProblems, setShowProblems] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState(false)
  const { language } = useLocalized()
  // «كتابة سؤال جديد»: the bank is being found (or made), then the editor is open on it.
  const [findingBank, setFindingBank] = useState(false)
  const [writingIn, setWritingIn] = useState<QuestionBank | null>(null)

  const startWriting = async () => {
    if (findingBank) return
    setFindingBank(true)
    setError(null)
    try {
      setWritingIn(await courseQuestionBank(course, t('examOnline.editor.write.bankName', { course: localizedLabel(course.name, language) })))
    } catch (caught) {
      setError(t('examOnline.editor.write.bankError', { reason: failureMessage(t, describeExamsFailure(caught)) }))
    } finally {
      setFindingBank(false)
    }
  }

  const plan = planQuestionsSave(data.items, rows)
  // Rows the save would send — or refuse instead of sending — are unsaved work; rows changed back hold nothing.
  const unsaved = plan.kind !== 'unchanged'
  useEffect(() => {
    onUnsavedChange(unsaved)
    return () => onUnsavedChange(false)
  }, [unsaved, onUnsavedChange])

  const problems: ReadonlyMap<string, RowProblem> = showProblems && plan.kind === 'invalid' ? plan.problems : new Map()
  const room = roomLeft(rows)

  // A removed row takes the focused button with it: the focus goes on to the row that took its place (the last one
  // after the last was removed), or to «إضافة أسئلة» once none is left — never back to the top of the page.
  const listRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const focusAfterRemoval = useRef<number | null>(null)
  useEffect(() => {
    const index = focusAfterRemoval.current
    if (index === null) return
    focusAfterRemoval.current = null
    const removeButtons = listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-row-action="remove"]')
    const next = removeButtons?.[Math.min(index, removeButtons.length - 1)]
    ;(next ?? addRef.current)?.focus()
  }, [rows])

  const edit = (change: (current: QuestionRow[]) => QuestionRow[]) => {
    setRows(change)
    setError(null)
  }

  const discard = () => {
    setRows(rowsOf(data.items))
    setRefused(new Map())
    setShowProblems(false)
    setError(null)
  }

  const save = async () => {
    if (plan.kind === 'unchanged') {
      message.info(t('examOnline.editor.nothingChanged'))
      return
    }
    if (plan.kind === 'invalid') {
      setShowProblems(true)
      setError(t('examOnline.editor.fixRows'))
      return
    }
    if (plan.kind === 'too_many') {
      setError(t('examOnline.editor.errors.too_many', { max: EXAM_QUESTIONS_MAX }))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await replaceExamQuestions(data.examId, plan.questions)
      message.success(t('examOnline.editor.saved'))
      // The parent replaces the set with the server's answer, which remounts this editor (a new session).
      onSaved(saved)
    } catch (caught) {
      setSaving(false)
      const failure = describeQuestionSetFailure(caught)
      const text = failureMessage(t, failure)
      if (failure.next === 'refused') {
        const reason = failure.rowReason
        setRefused(new Map(reason ? (failure.questionIds ?? []).map((id) => [id, reason] as const) : []))
        setError(text)
        return
      }
      if (failure.next === 'stale' || failure.next === 'gone') {
        message.error(text)
        onStale()
        return
      }
      setError(text)
    }
  }

  const problemText = (problem: RowProblem | undefined) =>
    problem === 'points_required' ? t('examOnline.editor.pointsRequired') : problem === 'points_invalid' ? t('examOnline.editor.pointsInvalid', { min: QUESTION_POINTS_MIN, max: QUESTION_POINTS_LIMIT }) : undefined

  return (
    <Flex vertical gap={12}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {t('examOnline.editor.intro')}
      </Typography.Paragraph>

      <Flex justify="space-between" align="center" wrap gap={8}>
        <Space wrap size={8}>
          <Tag>{t('examOnline.editor.count', { value: rows.length, max: EXAM_QUESTIONS_MAX })}</Tag>
          <PointsTotal total={formatHundredths(totalHundredths(rows))} max={maxScore} matches={rows.length === 0 ? null : totalMatchesMaxScore(rows, maxScore)} />
        </Space>
        <Space wrap>
          {previewButton(unsaved)}
          <Button ref={addRef} icon={<DatabaseOutlined />} onClick={() => setPicking(true)} disabled={saving || room === 0} title={room === 0 ? t('examOnline.editor.maxReached', { max: EXAM_QUESTIONS_MAX }) : undefined}>
            {t('examOnline.editor.pickFromBank')}
          </Button>
          <Button icon={<EditOutlined />} onClick={() => void startWriting()} loading={findingBank} disabled={saving || room === 0} title={room === 0 ? t('examOnline.editor.maxReached', { max: EXAM_QUESTIONS_MAX }) : undefined}>
            {t('examOnline.editor.writeNew')}
          </Button>
          {unsaved ? (
            <Popconfirm title={t('examOnline.editor.discardConfirm')} okText={t('examOnline.editor.discard')} cancelText={t('common.cancel')} onConfirm={discard} disabled={saving}>
              <Button icon={<UndoOutlined />} disabled={saving}>
                {t('examOnline.editor.discard')}
              </Button>
            </Popconfirm>
          ) : (
            <Button icon={<ReloadOutlined />} onClick={onReload} loading={reloading} disabled={saving}>
              {t('examOnline.questions.refresh')}
            </Button>
          )}
          <Button type="primary" icon={<SaveOutlined />} onClick={() => void save()} disabled={!unsaved} loading={saving}>
            {t('examOnline.editor.save')}
          </Button>
        </Space>
      </Flex>
      {unsaved ? (
        <Typography.Text type="warning" id="exam-preview-hint" data-testid="exam-questions-unsaved">
          {t('examOnline.editor.unsaved')} — {t('examOnline.preview.saveFirst')}
        </Typography.Text>
      ) : null}

      {/* The server's own word about the saved set: a question can lose its «ready» in its bank after it was linked. */}
      {data.problems.includes('questions_not_ready') ? <Alert type="warning" showIcon title={t('examOnline.editor.serverNotReady')} /> : null}
      {error ? <Alert type="error" showIcon title={error} data-testid="exam-questions-error" /> : null}

      {rows.length === 0 ? (
        <Flex vertical gap={12} data-testid="exam-questions-choose">
          <Typography.Text strong>
            {t('examOnline.editor.empty')} {t('examOnline.editor.chooseHow')}
          </Typography.Text>
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12}>
              <Card hoverable={!saving} onClick={() => (saving ? undefined : setPicking(true))} style={{ height: '100%', textAlign: 'center' }}>
                <DatabaseOutlined style={{ fontSize: 28 }} />
                <Typography.Title level={5} style={{ marginTop: 8 }}>
                  {t('examOnline.editor.pickFromBank')}
                </Typography.Title>
                <Typography.Text type="secondary">{t('examOnline.editor.pickFromBankHint')}</Typography.Text>
              </Card>
            </Col>
            <Col xs={24} sm={12}>
              <Card hoverable={!saving} onClick={() => (saving ? undefined : void startWriting())} style={{ height: '100%', textAlign: 'center' }}>
                <EditOutlined style={{ fontSize: 28 }} />
                <Typography.Title level={5} style={{ marginTop: 8 }}>
                  {t('examOnline.editor.writeNew')}
                </Typography.Title>
                <Typography.Text type="secondary">{t('examOnline.editor.writeNewHint')}</Typography.Text>
              </Card>
            </Col>
          </Row>
        </Flex>
      ) : null}
      <div ref={listRef} role="list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row, index) => {
          const number = index + 1
          const problem = problems.get(row.questionId)
          return (
            <SetRow
              key={row.questionId}
              row={row}
              number={number}
              refused={refused.get(row.questionId)}
              problem={problemText(problem)}
              points={
                <Space size={4}>
                  <Typography.Text type="secondary">{t('examOnline.editor.pointsLabel')}</Typography.Text>
                  {/* No min/max: antd would clamp an out-of-range value silently on blur — the row says what is wrong instead. */}
                  <InputNumber
                    size="small"
                    value={row.points}
                    disabled={saving}
                    status={problem ? 'error' : undefined}
                    onChange={(value) => edit((current) => setRowPoints(current, row.questionId, typeof value === 'number' ? value : null))}
                    aria-label={t('examOnline.editor.pointsOf', { number })}
                    style={{ width: 96 }}
                  />
                </Space>
              }
              actions={
                <>
                  <Button size="small" icon={<ArrowUpOutlined />} aria-label={t('examOnline.editor.moveUp', { number })} disabled={saving || index === 0} onClick={() => edit((current) => moveRow(current, row.questionId, -1))} />
                  <Button
                    size="small"
                    icon={<ArrowDownOutlined />}
                    aria-label={t('examOnline.editor.moveDown', { number })}
                    disabled={saving || index === rows.length - 1}
                    onClick={() => edit((current) => moveRow(current, row.questionId, 1))}
                  />
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={t('examOnline.editor.remove', { number })}
                    data-row-action="remove"
                    disabled={saving}
                    onClick={() => {
                      focusAfterRemoval.current = index
                      edit((current) => removeRow(current, row.questionId))
                    }}
                  />
                </>
              }
            />
          )
        })}
      </div>

      {picking ? (
        <QuestionPickerModal
          linkedIds={new Set(rows.map((row) => row.questionId))}
          room={room}
          onAdd={(picked) => {
            edit((current) => picked.reduce((next, { question, bank }) => addQuestions(next, [question], bank), current))
            setPicking(false)
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}

      {writingIn ? (
        <QuestionEditor
          // A new question per session (KI-049).
          key={writingIn.id}
          bank={writingIn}
          question={null}
          forExam
          onClose={() => setWritingIn(null)}
          onSaved={(question) => {
            edit((current) => addQuestions(current, [question], writingIn))
            setWritingIn(null)
            message.success(t('examOnline.editor.write.added'))
          }}
          onStale={() => {
            setWritingIn(null)
            setError(t('examOnline.editor.write.bankError', { reason: t('questionBanks.errors.question_bank_not_found') }))
          }}
        />
      ) : null}
    </Flex>
  )
}

// --- An exam that was made available: the frozen copies with their key ---------

interface FrozenQuestionsProps {
  data: ExamQuestions
  /** The caller holds `exams.grade` and the class takes corrections. */
  correctable: boolean
  /** A grader, but the class is cancelled: say why no key can be corrected. */
  classCancelled: boolean
  toolbar: ReactNode
  onCorrect: (item: ExamQuestionItem, number: number) => void
}

function FrozenQuestions({ data, correctable, classCancelled, toolbar, onCorrect }: FrozenQuestionsProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { token } = theme.useToken()
  return (
    <Flex vertical gap={12}>
      <Alert type="info" showIcon title={t('examOnline.frozen.note')} data-testid="exam-questions-frozen-note" />
      {classCancelled ? <Alert type="warning" showIcon title={t('examOnline.frozen.classCancelled')} /> : null}
      <Flex justify="space-between" align="center" wrap gap={8}>
        {/* The server's numbers: an exam that was made available holds points equal to its maximum score. */}
        <Typography.Text strong data-testid="exam-questions-total">
          {t('examOnline.frozen.summary', { value: data.items.length, total: data.totalPoints, max: data.maxScore })}
        </Typography.Text>
        {toolbar}
      </Flex>
      {data.items.length === 0 ? <Empty description={t('examOnline.frozen.empty')} /> : null}
      {data.items.map((item, index) => {
        const number = index + 1
        const choices = answerChoicesOf(item.question)
        return (
          <section key={item.id} data-testid="exam-question-card" style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadius, padding: 12 }}>
            {/* Its own wrapping header, not a Card title: that one never wraps and would cut the tags on a phone. */}
            <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 8 }}>
              <Space size={4} wrap>
                <Typography.Text strong>{t('examOnline.questions.question', { number })}</Typography.Text>
                <Tag>{t(`examOnline.types.${item.question.type}`)}</Tag>
                <Tag>{t('examOnline.questions.points', { points: item.points })}</Tag>
              </Space>
              {correctable ? (
                <Button size="small" icon={<KeyOutlined />} onClick={() => onCorrect(item, number)} aria-label={t('examOnline.frozen.correctKeyOf', { number })}>
                  {t('examOnline.frozen.correctKey')}
                </Button>
              ) : null}
            </Flex>
            {/* A plain element: antd Typography's RTL class would override dir="auto". */}
            <div dir="auto" style={{ fontWeight: 600, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBottom: 8 }}>
              {localizedLabel(item.question.prompt, language)}
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {choices.map((choice) => (
                <li
                  key={choice.value}
                  data-key={choice.isKey ? 'true' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 8,
                    padding: '4px 8px',
                    borderRadius: token.borderRadiusSM,
                    border: `1px solid ${choice.isKey ? token.colorSuccessBorder : token.colorBorderSecondary}`,
                    background: choice.isKey ? token.colorSuccessBg : undefined,
                  }}
                >
                  <span dir="auto" style={{ overflowWrap: 'anywhere' }}>
                    {choice.text ? localizedLabel(choice.text, language) : t(`examOnline.answers.${choice.answer}`)}
                  </span>
                  {choice.isKey ? (
                    <Tag color="green" icon={<CheckCircleFilled />} data-testid="exam-question-key">
                      {t('examOnline.frozen.correct')}
                    </Tag>
                  ) : null}
                </li>
              ))}
            </ul>
            {choices.some((choice) => choice.isKey) ? null : (
              <Typography.Text type="warning" style={{ display: 'block', marginTop: 8 }}>
                {t('examOnline.frozen.noKey')}
              </Typography.Text>
            )}
            {item.question.explanation ? (
              <div style={{ marginTop: 8 }} data-testid="exam-question-explanation">
                <Typography.Text type="secondary">{t('examOnline.frozen.explanation')}</Typography.Text>
                <div dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {localizedLabel(item.question.explanation, language)}
                </div>
              </div>
            ) : null}
            {item.corrections.length > 0 ? (
              <div style={{ marginTop: 8 }} data-testid="exam-question-corrections">
                <Typography.Text type="secondary">{t('examOnline.frozen.corrections')}</Typography.Text>
                <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                  {item.corrections.map((correction) => (
                    // When and why — the server names who by an id only, so no name is shown.
                    <li key={`${correction.at}:${correction.reason}`}>
                      <Typography.Text type="secondary">{formatDateTime(correction.at, language)}</Typography.Text> — <span dir="auto">{correction.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        )
      })}
    </Flex>
  )
}
