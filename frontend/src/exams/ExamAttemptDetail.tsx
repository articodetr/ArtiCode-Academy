// One attempt at an online exam as its teacher reads it (MOD-09 phase 2 —
// OEX-T07): a drawer above the exam drawer, on the pattern of
// assignments/SubmissionReviewPanel.tsx, that reads GET /api/exam-attempts/:id
// (API-275) and shows the attempt — the student in the caller's D-R07
// projection, its number, status and instants in the exam's zone (D-R41), its
// score out of the maximum, how many answers were correct, whether it is the
// counted one and when it was last graded — then every frozen question in the
// exam's order with its choices, THE KEY marked, the student's answer marked,
// the server's verdict and the points it earned. **This panel carries the
// key**: it is for the teacher's side only (the learner's own reading is
// API-277, which never carries one). Nothing is graded here: right and wrong
// are the server's `isCorrect`, the points its `pointsAwarded`; while the
// attempt is in progress both are null and the panel says so — what is marked
// then is what the student had saved when it was read. Read-only, so it closes
// like any panel. An attempt that is gone or out of reach (404
// `attempt_not_found`) says so, closes the panel and has the roster read again;
// any other failed read stays with a retry.
import { Alert, App, Button, Card, Descriptions, Drawer, Flex, Skeleton, Space, Tag, Typography, theme } from 'antd'
import type { GlobalToken } from 'antd'
import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExamAttemptDetail as AttemptDetail, TeacherAttemptQuestion } from '../api/examAttempts'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { describeAttemptsFailure, failureMessage, isAttemptsFailure } from './examAttempts.errors'
import { useExamAttempt } from './examAttempts.hooks'
import { AttemptStatusTag, ExamZoneNote, OutOf } from './examAttempts.parts'
import { attemptEndOf, isAnswered, optionToneOf, questionNumberOf, questionOutcomeOf, shownOptionsOf } from './examAttempts.view'
import type { OptionTone, QuestionOutcome } from './examAttempts.view'

interface ExamAttemptDetailProps {
  /** The attempt the roster opened. */
  attemptId: string
  /** The name the roster shows, for the title until the attempt is read. */
  studentName: string
  /** The exam's zone (D-R41): every instant of the attempt is shown in it. */
  timeZone: string
  /** The roster's `timeUp` for this attempt: its deadline had passed at the server clock while it was still open. */
  timeUp: boolean
  onClose: () => void
  /** The attempt is gone or out of reach (404): the roster is read again. */
  onStale: () => void
}

export function ExamAttemptDetail({ attemptId, studentName, timeZone, timeUp, onClose, onStale }: ExamAttemptDetailProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { attempt, error, reload } = useExamAttempt(attemptId)
  const failure = error ? describeAttemptsFailure(error) : null
  const gone = failure !== null && isAttemptsFailure(failure, 'attempt_not_found')

  // The handlers of the latest render, for the effect below (assigned in an effect — react(immutability)).
  const latest = useRef({ onClose, onStale })
  useEffect(() => {
    latest.current = { onClose, onStale }
  })

  // An attempt that is gone (or out of reach) is no longer on the roster as it was: say so, re-read the roster, close.
  useEffect(() => {
    if (!gone) return
    message.error(t('examAttempts.errors.attempt_not_found'))
    latest.current.onStale()
    latest.current.onClose()
  }, [gone, message, t])

  return (
    <Drawer
      open
      onClose={onClose}
      title={t('examAttempts.detail.titleOf', { name: attempt?.student.fullName ?? studentName })}
      // antd 6: `size` takes a CSS length; the panel never exceeds a phone viewport.
      size="min(640px, 100vw)"
      destroyOnHidden
    >
      {failure && !gone ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={reload}>
              {t('examAttempts.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {!attempt && !failure ? <Skeleton active paragraph={{ rows: 8 }} data-testid="attempt-loading" /> : null}
      {attempt ? <AttemptBody attempt={attempt} timeZone={timeZone} timeUp={timeUp} /> : null}
    </Drawer>
  )
}

function AttemptBody({ attempt, timeZone, timeUp }: { attempt: AttemptDetail; timeZone: string; timeUp: boolean }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { student } = attempt
  const inProgress = attempt.status === 'in_progress'
  const end = attemptEndOf(attempt)
  const instant = (iso: string) => formatZonedDateTime(iso, timeZone, language)
  const notGraded = <Typography.Text type="secondary">{t('examAttempts.detail.notGraded')}</Typography.Text>

  return (
    <>
      <Alert type="warning" showIcon title={t('examAttempts.detail.keyNote')} style={{ marginBottom: 12 }} />
      {inProgress ? <Alert type="info" showIcon title={t('examAttempts.detail.inProgressNote')} style={{ marginBottom: 12 }} data-testid="attempt-in-progress" /> : null}

      <Descriptions column={1} bordered size="small" style={{ marginBottom: 8 }} data-testid="attempt-details">
        <Descriptions.Item label={t('examAttempts.detail.fields.student')}>
          <Space orientation="vertical" size={0}>
            <span>
              {student.fullName}
              {student.displayName && student.displayName !== student.fullName ? <Typography.Text type="secondary"> ({student.displayName})</Typography.Text> : null}
            </span>
            {/* The contact of the full projection only (users.read_contact — D-R07); null otherwise, and then nothing shows. */}
            {student.email ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                <bdi dir="ltr">{student.email}</bdi>
              </Typography.Text>
            ) : null}
            {student.phone ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                <bdi dir="ltr">{student.phone}</bdi>
              </Typography.Text>
            ) : null}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t('examAttempts.detail.fields.attempt')}>{t('examAttempts.detail.attemptNumber', { number: attempt.attemptNo })}</Descriptions.Item>
        <Descriptions.Item label={t('examAttempts.detail.fields.status')}>
          <Space wrap size={4}>
            <AttemptStatusTag status={attempt.status} />
            {inProgress && timeUp ? <Typography.Text type="warning">{t('examAttempts.roster.timeUp')}</Typography.Text> : null}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t('examAttempts.detail.fields.startedAt')}>{instant(attempt.startedAt)}</Descriptions.Item>
        {end ? <Descriptions.Item label={t(`examAttempts.detail.fields.${end.kind}`)}>{instant(end.iso)}</Descriptions.Item> : null}
        <Descriptions.Item label={t('examAttempts.detail.fields.score')}>
          {attempt.score !== null ? (
            <Typography.Text strong>
              <OutOf value={attempt.score} total={attempt.maxScore} />
            </Typography.Text>
          ) : (
            notGraded
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('examAttempts.detail.fields.correctCount')}>
          {attempt.correctCount !== null ? <OutOf value={attempt.correctCount} total={attempt.questionCount} /> : notGraded}
        </Descriptions.Item>
        <Descriptions.Item label={t('examAttempts.detail.fields.counted')}>
          {attempt.counted ? (
            // A short tag and its meaning beside it as text: a tag never wraps, and a sentence in one overflowed a phone.
            <Space size={[4, 2]} wrap>
              <Tag color="gold">{t('examAttempts.roster.counted')}</Tag>
              <Typography.Text type="secondary">{t('examAttempts.detail.counted')}</Typography.Text>
            </Space>
          ) : (
            <Typography.Text type="secondary">{t(inProgress ? 'examAttempts.detail.notCountedYet' : 'examAttempts.detail.notCounted')}</Typography.Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('examAttempts.detail.fields.gradedAt')}>{attempt.gradedAt ? instant(attempt.gradedAt) : notGraded}</Descriptions.Item>
      </Descriptions>
      <div style={{ marginBottom: 16 }}>
        <ExamZoneNote zone={timeZone} testId="attempt-zone" />
      </div>

      <Typography.Title level={5}>{t('examAttempts.detail.questionsTitle')}</Typography.Title>
      {attempt.questions.length === 0 ? <Typography.Text type="secondary">{t('examAttempts.detail.noQuestions')}</Typography.Text> : null}
      {attempt.questions.map((question) => (
        <QuestionCard key={question.id} question={question} />
      ))}
    </>
  )
}

const OUTCOME_COLORS: Readonly<Record<Exclude<QuestionOutcome, 'ungraded'>, string>> = { correct: 'green', wrong: 'red', unanswered: 'default' }

/** How a choice is tinted: the key and a right answer as success, a wrong answer as error, an answer not graded yet as info. */
function toneStyle(tone: OptionTone, token: GlobalToken): CSSProperties {
  switch (tone) {
    case 'key':
    case 'right':
      return { background: token.colorSuccessBg, borderColor: token.colorSuccessBorder }
    case 'wrong':
      return { background: token.colorErrorBg, borderColor: token.colorErrorBorder }
    case 'pending':
      return { background: token.colorInfoBg, borderColor: token.colorInfoBorder }
    case 'plain':
      return { borderColor: token.colorBorder }
  }
}

/** One frozen question: its text, its choices with the key and the student's answer marked, the server's verdict and points. */
function QuestionCard({ question }: { question: TeacherAttemptQuestion }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { token } = theme.useToken()
  const number = questionNumberOf(question.sortOrder)
  const outcome = questionOutcomeOf(question)
  const name = t('examAttempts.detail.question', { number })

  return (
    <Card
      size="small"
      // A named group, so a screen reader says which question a choice belongs to.
      role="group"
      aria-label={name}
      title={name}
      extra={outcome === 'ungraded' ? null : <Tag color={OUTCOME_COLORS[outcome]}>{t(`examAttempts.detail.outcome.${outcome}`)}</Tag>}
      style={{ marginBottom: 12 }}
      data-testid={`attempt-question-${number}`}
    >
      {/* Plain elements: antd Typography's RTL class would override `dir` (an English question keeps its own direction). */}
      <div dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontWeight: 600, marginBottom: 8 }}>
        {localizedLabel(question.prompt, language)}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shownOptionsOf(question).map((option) => (
          <li
            key={option.key}
            style={{ border: '1px solid', borderRadius: token.borderRadius, padding: '6px 10px', ...toneStyle(optionToneOf(option, question.isCorrect), token) }}
            data-testid={`attempt-option-${number}-${option.key}`}
          >
            <Flex justify="space-between" align="center" gap={8} wrap>
              <div dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minWidth: 0 }}>
                {option.text ? localizedLabel(option.text, language) : t(`examAttempts.detail.trueFalse.${String(option.truth)}`)}
              </div>
              {option.isKey || option.isChosen ? (
                <Space size={4} wrap>
                  {option.isKey ? <Tag color="green">{t('examAttempts.detail.key')}</Tag> : null}
                  {option.isChosen ? <Tag color="blue">{t('examAttempts.detail.chosen')}</Tag> : null}
                </Space>
              ) : null}
            </Flex>
          </li>
        ))}
      </ul>
      {isAnswered(question.answer) ? null : (
        <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
          {t(outcome === 'ungraded' ? 'examAttempts.detail.unansweredYet' : 'examAttempts.detail.unanswered')}
        </Typography.Paragraph>
      )}
      <Flex gap={12} wrap align="center" style={{ marginTop: 8 }}>
        <Tag>{t(`examAttempts.detail.type.${question.type}`)}</Tag>
        {question.pointsAwarded !== null ? (
          <span>
            {t('examAttempts.detail.earned')} <OutOf value={question.pointsAwarded} total={question.points} />
          </span>
        ) : (
          <span>
            {t('examAttempts.detail.points')} <bdi dir="ltr">{question.points}</bdi>
          </span>
        )}
      </Flex>
      {question.explanation ? (
        <div style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">{t('examAttempts.detail.explanation')}</Typography.Text>
          <div dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {localizedLabel(question.explanation, language)}
          </div>
        </div>
      ) : null}
    </Card>
  )
}
