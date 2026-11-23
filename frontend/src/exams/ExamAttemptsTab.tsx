// The «attempts» tab of the exam drawer (MOD-09 phase 2, roadmap §4r —
// OEX-T07), for the teacher and the office: who took an online exam and how it
// went. It reads GET /api/exams/:id/attempts (API-274) when it mounts — the
// drawer mounts it for an online exam only — and again on «refresh», after a
// regrade, and when the exam changes in the drawer (useExamAttempts); nothing
// is polled, and the line under the header says at which server clock the
// answer was read. It shows where that clock falls in the exam's window with
// the opening and closing instants in the exam's zone (D-R41, named when it is
// not this device's); the exam's figures; how each question went; and the
// roster in the server's (enrollment) order — each student in the caller's
// D-R07 projection with their counted result and its source, and their
// attempts with status, instants, score, the mark of the COUNTED attempt and
// the server's `timeUp`. **Every number is the server's**: no score, mean,
// rate or percentage is computed here — the figures are `stats`, a question's
// two counts are shown as two counts. The filter works on the loaded rows (the
// whole roster, unpaginated — exact). An attempt opens ExamAttemptDetail
// (API-275, the key and the student's answers) above the drawer. A holder of
// `exams.grade` may ask for a regrade (RegradeModal — API-273) of an exam that
// is not a draft and whose class is not cancelled; the tab then words the
// server's counts, reads the roster again and, when something changed, has the
// drawer re-read the exam (`onChanged`: its result counts follow).
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Collapse, Flex, Select, Skeleton, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExamAttemptRow, ExamAttempts, ExamAttemptsStudent, ExamQuestionStat } from '../api/examAttempts'
import type { RegradeSummary } from '../api/examQuestions'
import type { Exam } from '../api/exams'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { ExamAttemptDetail } from './ExamAttemptDetail'
import { describeAttemptsFailure, failureMessage, isAttemptsFailure } from './examAttempts.errors'
import { useExamAttempts, useFocusReturn } from './examAttempts.hooks'
import { AttemptStatusTag, ExamZoneNote, OutOf, ResultSourceTag } from './examAttempts.parts'
import { ATTEMPTS_FILTERS, WINDOW_STATE_COLORS, attemptEndOf, filterAttemptsRoster, questionNumberOf, regradeChangedSomething, regradeSummaryText } from './examAttempts.view'
import type { AttemptsFilter } from './examAttempts.view'
import { RESULT_STATUS_COLORS } from './exams.format'
import { isClassFrozenForExams } from './exams.status'
import { RegradeModal } from './RegradeModal'

export interface ExamAttemptsTabProps {
  /** An online exam (the drawer mounts the tab for `delivery === 'online'` only). */
  exam: Exam
  /** The drawer re-reads the exam (its result counts follow): after a regrade that changed results, and on «refresh». */
  onChanged: () => void
}

/** The attempt a row opens in the panel. */
interface OpenedAttempt {
  attemptId: string
  studentName: string
  timeUp: boolean
}

/** Up to this many questions the «questions» section starts open; a longer exam starts folded, so the roster stays within reach. */
const QUESTIONS_OPEN_MAX = 12

const DASH = '—'

export function ExamAttemptsTab({ exam, onChanged }: ExamAttemptsTabProps) {
  const { t } = useTranslation()
  const canGrade = useAuth().hasPermission('exams.grade')
  const { attempts, error, loading, reload } = useExamAttempts(exam.id, exam.updatedAt)
  const [opened, setOpened] = useState<OpenedAttempt | null>(null)
  const [regrading, setRegrading] = useState(false)
  const [lastRegrade, setLastRegrade] = useState<RegradeSummary | null>(null)
  // The panel and the dialog are unmounted when they close: the focus goes back to the button that opened them.
  const rememberAttemptOpener = useFocusReturn(opened !== null)
  const rememberRegradeOpener = useFocusReturn(regrading)
  const failure = error ? describeAttemptsFailure(error) : null
  const examGone = failure !== null && isAttemptsFailure(failure, 'exam_not_found')
  // A regrade needs an exam that was made available, of a class that is not cancelled (the server's `exam_not_frozen` / `class_closed`).
  const canRegrade = canGrade && exam.status !== 'draft' && !isClassFrozenForExams(exam.class.status)

  // The drawer's handler of the latest render, for the effect below (assigned in an effect — react(immutability)).
  const latestOnChanged = useRef(onChanged)
  useEffect(() => {
    latestOnChanged.current = onChanged
  })

  // The exam is gone or out of reach (404 on the roster): the drawer re-reads it, and says so.
  useEffect(() => {
    if (examGone) latestOnChanged.current()
  }, [examGone])

  return (
    <div data-testid="exam-attempts">
      {failure ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={reload}>
              {t('examAttempts.retry')}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {!attempts && !failure ? <Skeleton active paragraph={{ rows: 8 }} data-testid="exam-attempts-loading" /> : null}
      {attempts ? (
        <>
          <Flex justify="space-between" align="flex-start" wrap gap={8} style={{ marginBottom: 4 }}>
            <WindowLine attempts={attempts} zone={exam.timeZone} />
            <Space wrap>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  reload()
                  // Attempts finish while the drawer is open: the drawer re-reads the exam too, so its result
                  // counts and its «students' performance» summary follow the roster just read.
                  onChanged()
                }}
                loading={loading}
              >
                {t('examAttempts.refresh')}
              </Button>
              {canRegrade ? (
                <Button
                  onClick={(event) => {
                    rememberRegradeOpener(event.currentTarget)
                    setRegrading(true)
                  }}
                >
                  {t('examAttempts.regrade.button')}
                </Button>
              ) : null}
            </Space>
          </Flex>
          <ReadAt attempts={attempts} zone={exam.timeZone} />

          {exam.status === 'draft' ? <Alert type="info" showIcon title={t('examAttempts.draft')} style={{ marginBottom: 12 }} /> : null}
          {lastRegrade ? (
            <Alert
              type={regradeChangedSomething(lastRegrade) ? 'success' : 'info'}
              showIcon
              closable={{ onClose: () => setLastRegrade(null) }}
              title={regradeSummaryText(t, lastRegrade)}
              style={{ marginBottom: 12 }}
              data-testid="regrade-result"
            />
          ) : null}

          <Figures attempts={attempts} />
          <QuestionStats attempts={attempts} />
          <Roster
            attempts={attempts}
            zone={exam.timeZone}
            loading={loading}
            onOpen={(item, attempt, opener) => {
              rememberAttemptOpener(opener)
              setOpened({ attemptId: attempt.id, studentName: item.student.fullName, timeUp: attempt.timeUp })
            }}
          />
        </>
      ) : null}

      {opened ? (
        <ExamAttemptDetail
          // One panel per opened attempt: its request starts afresh.
          key={opened.attemptId}
          attemptId={opened.attemptId}
          studentName={opened.studentName}
          timeZone={exam.timeZone}
          timeUp={opened.timeUp}
          onClose={() => setOpened(null)}
          onStale={reload}
        />
      ) : null}
      {regrading ? (
        <RegradeModal
          // Mounted per session, so every regrade starts from an empty reason (KI-049).
          exam={exam}
          onClose={() => setRegrading(false)}
          onDone={(summary) => {
            setRegrading(false)
            setLastRegrade(summary)
            // The answer carries counts only: the roster and its figures are read again; the drawer re-reads the exam
            // when a result changed (its counts follow).
            reload()
            if (regradeChangedSomething(summary)) onChanged()
          }}
          onStale={onChanged}
        />
      ) : null}
    </div>
  )
}

interface SectionProps {
  attempts: ExamAttempts
}

/** Where the server clock falls in the exam's window, with the opening and closing instants in the exam's zone. */
function WindowLine({ attempts, zone }: SectionProps & { zone: string }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const instant = (iso: string | null) => (iso ? formatZonedDateTime(iso, zone, language) : t('examAttempts.window.unset'))
  return (
    <Space orientation="vertical" size={2} data-testid="exam-window">
      <Space wrap size={[8, 4]}>
        <Typography.Text strong>{t('examAttempts.window.title')}</Typography.Text>
        <Tag color={WINDOW_STATE_COLORS[attempts.window]}>{t(`examAttempts.window.state.${attempts.window}`)}</Tag>
      </Space>
      <Space wrap size={[16, 0]}>
        <span data-testid="exam-window-opens">
          {t('examAttempts.window.opensAt')} {instant(attempts.scheduledAt)}
        </span>
        <span data-testid="exam-window-closes">
          {t('examAttempts.window.closesAt')} {instant(attempts.closesAt)}
        </span>
      </Space>
      <ExamZoneNote zone={zone} testId="exam-attempts-zone" />
    </Space>
  )
}

/** The server clock of the answer on screen: nothing is polled, so the tab says how old what it shows is. */
function ReadAt({ attempts, zone }: SectionProps & { zone: string }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return (
    <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }} data-testid="exam-attempts-read-at">
      {t('examAttempts.asOf', { time: formatZonedDateTime(attempts.serverNow, zone, language) })}
    </Typography.Paragraph>
  )
}

/** One figure of the exam: its label and the server's value. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {label}
        </Typography.Text>
      </dt>
      <dd style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>{children}</dd>
    </div>
  )
}

/** A whole number as the server sent it. */
function Count({ value }: { value: number | null }) {
  return value === null ? <>{DASH}</> : <bdi dir="ltr">{value}</bdi>
}

/** The exam's figures (`stats`): who started, is in progress, finished and did not start; the mean, the range and the passes of the counted scores. */
function Figures({ attempts }: SectionProps) {
  const { t } = useTranslation()
  const { stats, maxScore, passScore } = attempts
  const score = (value: number | null) => (value === null ? DASH : <OutOf value={value} total={maxScore} />)
  return (
    <Card size="small" title={t('examAttempts.stats.title')} style={{ marginBottom: 12 }} data-testid="exam-attempts-stats">
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: '12px 16px', margin: '0 0 12px' }}>
        <Figure label={t('examAttempts.stats.students')}>
          <Count value={stats.students} />
        </Figure>
        <Figure label={t('examAttempts.stats.started')}>
          <Count value={stats.started} />
        </Figure>
        <Figure label={t('examAttempts.stats.inProgress')}>
          <Count value={stats.inProgress} />
        </Figure>
        <Figure label={t('examAttempts.stats.finished')}>
          <Count value={stats.finished} />
        </Figure>
        <Figure label={t('examAttempts.stats.notStarted')}>
          <Count value={stats.notStarted} />
        </Figure>
        <Figure label={t('examAttempts.stats.mean')}>{score(stats.mean)}</Figure>
        <Figure label={t('examAttempts.stats.highest')}>{score(stats.highest)}</Figure>
        <Figure label={t('examAttempts.stats.lowest')}>{score(stats.lowest)}</Figure>
        {passScore !== null ? (
          <>
            <Figure label={t('examAttempts.stats.passScore')}>
              <OutOf value={passScore} total={maxScore} />
            </Figure>
            <Figure label={t('examAttempts.stats.passed')}>
              <Count value={stats.passed} />
            </Figure>
            <Figure label={t('examAttempts.stats.failed')}>
              <Count value={stats.failed} />
            </Figure>
            {/* The server's percentage as it is (passed ÷ finished); the sign stays beside the number in an RTL line. */}
            <Figure label={t('examAttempts.stats.passRate')}>{stats.passRate === null ? DASH : <bdi dir="ltr">{`${stats.passRate}%`}</bdi>}</Figure>
          </>
        ) : null}
      </dl>
      {passScore === null ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
          {t('examAttempts.stats.noPassScore')}
        </Typography.Paragraph>
      ) : null}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('examAttempts.stats.countedNote')}
      </Typography.Text>
    </Card>
  )
}

/** How each question went over the counted attempts: the two counts the server sends, as counts. */
function QuestionStats({ attempts }: SectionProps) {
  const { t } = useTranslation()
  const number = (value: number) => <bdi dir="ltr">{value}</bdi>
  const columns: TableProps<ExamQuestionStat>['columns'] = [
    { title: t('examAttempts.questions.columns.question'), key: 'question', render: (_, item) => t('examAttempts.questions.number', { number: questionNumberOf(item.sortOrder) }) },
    { title: t('examAttempts.questions.columns.points'), key: 'points', render: (_, item) => number(item.points) },
    { title: t('examAttempts.questions.columns.answered'), key: 'answered', render: (_, item) => number(item.answered) },
    { title: t('examAttempts.questions.columns.correct'), key: 'correct', render: (_, item) => number(item.correct) },
  ]
  return (
    <Collapse
      size="small"
      defaultActiveKey={attempts.questions.length <= QUESTIONS_OPEN_MAX ? ['questions'] : []}
      style={{ marginBottom: 16 }}
      items={[
        {
          key: 'questions',
          label: t('examAttempts.questions.title'),
          extra: <Typography.Text type="secondary">{t('examAttempts.questions.count', { count: attempts.questionCount })}</Typography.Text>,
          children: (
            <div data-testid="exam-attempts-questions">
              <Space orientation="vertical" size={0} style={{ marginBottom: 8 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('examAttempts.questions.hint')}
                </Typography.Text>
                {/* The denominator the two counts are read against: the students with a finished attempt (`stats.finished`). */}
                <Typography.Text type="secondary" style={{ fontSize: 12 }} data-testid="exam-attempts-counted">
                  {t('examAttempts.questions.countedAttempts')} <bdi dir="ltr">{attempts.stats.finished}</bdi>
                </Typography.Text>
              </Space>
              <Table<ExamQuestionStat>
                rowKey={(item) => item.examQuestionId}
                columns={columns}
                dataSource={attempts.questions}
                pagination={false}
                size="small"
                scroll={{ x: true }}
                locale={{ emptyText: t('examAttempts.questions.empty') }}
              />
            </div>
          ),
        },
      ]}
    />
  )
}

interface RosterProps extends SectionProps {
  zone: string
  loading: boolean
  /** `opener` = the button that was pressed: the focus returns to it when the panel closes. */
  onOpen: (item: ExamAttemptsStudent, attempt: ExamAttemptRow, opener: HTMLElement) => void
}

/** The students in the server's order with their counted result and their attempts; the filter works on the loaded rows. */
function Roster({ attempts, zone, loading, onOpen }: RosterProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [filter, setFilter] = useState<AttemptsFilter>('all')
  const rows = filterAttemptsRoster(attempts.items, filter)
  const instant = (iso: string) => formatZonedDateTime(iso, zone, language)

  const columns: TableProps<ExamAttemptsStudent>['columns'] = [
    {
      title: t('examAttempts.roster.columns.student'),
      key: 'student',
      render: (_, item) => (
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>{item.student.fullName}</Typography.Text>
          {item.student.displayName && item.student.displayName !== item.student.fullName ? <Typography.Text type="secondary">{item.student.displayName}</Typography.Text> : null}
          {/* The contact of the full projection only (users.read_contact — D-R07); null otherwise, and then nothing shows. */}
          {item.student.email ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <bdi dir="ltr">{item.student.email}</bdi>
            </Typography.Text>
          ) : null}
          {item.student.phone ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <bdi dir="ltr">{item.student.phone}</bdi>
            </Typography.Text>
          ) : null}
          {item.enrollmentStatus !== 'active' || item.student.deletedAt ? (
            <Space size={4} wrap>
              {item.enrollmentStatus === null ? <Tag>{t('exams.results.enrollment.none')}</Tag> : item.enrollmentStatus !== 'active' ? <StatusTag value={item.enrollmentStatus} /> : null}
              {item.student.deletedAt ? <Tag color="volcano">{t('exams.results.deleted')}</Tag> : null}
            </Space>
          ) : null}
        </Space>
      ),
    },
    {
      title: t('examAttempts.roster.columns.result'),
      key: 'result',
      render: (_, item) => {
        const { result } = item
        if (!result) return <Typography.Text type="secondary">{t('examAttempts.roster.noResult')}</Typography.Text>
        return (
          <Space size={4} wrap>
            {result.status === 'scored' && result.score !== null ? (
              <Typography.Text strong>
                <OutOf value={result.score} total={attempts.maxScore} />
              </Typography.Text>
            ) : (
              <Tag color={RESULT_STATUS_COLORS[result.status]}>{t(`exams.results.status.${result.status}`)}</Tag>
            )}
            <ResultSourceTag source={result.source} />
          </Space>
        )
      },
    },
    {
      title: t('examAttempts.roster.columns.attempts'),
      key: 'attempts',
      render: (_, item) => {
        if (item.attempts.length === 0) return <Typography.Text type="secondary">{t('examAttempts.roster.notStarted')}</Typography.Text>
        return (
          <Flex vertical gap={10}>
            {item.attempts.map((attempt) => {
              const end = attemptEndOf(attempt)
              return (
                <div key={attempt.id} data-testid={`attempt-${attempt.id}`}>
                  <Space size={[6, 2]} wrap align="center">
                    <Button
                      type="link"
                      size="small"
                      style={{ paddingInline: 0 }}
                      onClick={(event) => onOpen(item, attempt, event.currentTarget)}
                      aria-label={t('examAttempts.roster.open', { number: attempt.attemptNo, name: item.student.fullName })}
                    >
                      {t('examAttempts.roster.attempt', { number: attempt.attemptNo })}
                    </Button>
                    <AttemptStatusTag status={attempt.status} />
                    {attempt.counted ? <Tag color="gold">{t('examAttempts.roster.counted')}</Tag> : null}
                    {attempt.score !== null ? <OutOf value={attempt.score} total={attempts.maxScore} /> : null}
                  </Space>
                  <div>
                    {/* Each instant stays whole: in a narrow column it drops under its label rather than leaving «ص» alone on a line. */}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t('examAttempts.roster.startedAt')} <span style={{ whiteSpace: 'nowrap' }}>{instant(attempt.startedAt)}</span>
                      {end ? (
                        <>
                          <br />
                          {t(`examAttempts.roster.${end.kind}`)} <span style={{ whiteSpace: 'nowrap' }}>{instant(end.iso)}</span>
                        </>
                      ) : null}
                    </Typography.Text>
                  </div>
                  {attempt.timeUp ? (
                    <Typography.Text type="warning" style={{ fontSize: 12 }}>
                      {t('examAttempts.roster.timeUp')}
                    </Typography.Text>
                  ) : null}
                </div>
              )
            })}
          </Flex>
        )
      },
    },
  ]

  return (
    <section aria-label={t('examAttempts.roster.title')} data-testid="exam-attempts-roster">
      <Typography.Title level={5}>{t('examAttempts.roster.title')}</Typography.Title>
      {attempts.items.length > 0 && attempts.stats.started === 0 ? <Alert type="info" showIcon title={t('examAttempts.roster.nobodyStarted')} style={{ marginBottom: 12 }} /> : null}
      <Space wrap style={{ marginBottom: 4 }}>
        <Select<AttemptsFilter>
          value={filter}
          onChange={setFilter}
          aria-label={t('examAttempts.roster.filter')}
          options={ATTEMPTS_FILTERS.map((value) => ({ value, label: t(`examAttempts.roster.filters.${value}`) }))}
          style={{ minWidth: 180 }}
        />
        {filter !== 'all' ? <Typography.Text type="secondary">{t('examAttempts.roster.shown', { shown: rows.length, total: attempts.items.length })}</Typography.Text> : null}
      </Space>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
        {t('examAttempts.roster.filterLocal')}
      </Typography.Paragraph>
      <Table<ExamAttemptsStudent>
        rowKey={(item) => item.student.id}
        columns={columns}
        dataSource={rows}
        loading={loading}
        pagination={false}
        size="small"
        scroll={{ x: true }}
        locale={{ emptyText: attempts.items.length > 0 ? t('examAttempts.roster.emptyFiltered') : t('examAttempts.roster.empty') }}
      />
    </section>
  )
}
