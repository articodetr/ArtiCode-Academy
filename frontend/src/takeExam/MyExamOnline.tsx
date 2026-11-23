// The online side of a «my exams» row (MOD-09 phase 2 — API-121 `online`),
// drawn inside the cells the row already has: when the exam opens and closes
// and how long one attempt may take; the number of questions and the attempts
// used; the action — «متابعة الاختبار» with the time left, «ابدأ الاختبار», or
// the reason it cannot be taken now; and the student's attempts.
//
// Everything comes from the SERVER's state of the item (`inProgress`,
// `canStart`, `blocker` — computed at its clock by the rule the start route
// enforces). The time left of an attempt in progress is the server's
// `remainingSeconds`, counted down on the monotonic clock from the moment the
// list arrived (useMyExams) — never this device's date. A guardian's row
// (`relation: child`) never offers to start and links no attempt.
import { Button, Typography } from 'antd'
import { useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { MyExamInProgress } from '../api/myExams'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { differsFromDevice } from '../assignments/assignments.zone'
import { onlineResultCellOf, takeStateOf } from '../exams/myExams.view'
import type { OnlineMyExamItem } from '../exams/myExams.view'
import type { Language } from '../i18n/language'
import { useLocalized } from '../i18n/useLocalized'
import type { Translate } from '../users/users.format'
import { AttemptsList } from './AttemptsList'
import { arrivalOf, formatClock } from './takeExam.clock'
import type { ClockSync } from './takeExam.clock'
import { takeExamPath } from './takeExam.format'
import { useAttemptClock } from './useAttemptClock'
import './myExamOnline.css'

const SMALL = { fontSize: 12 }

/** The «when» cell: the window in the exam's own zone (D-R41) and the time one attempt may take. */
export function OnlineWhenCell({ item }: { item: OnlineMyExamItem }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const zone = item.timeZone
  return (
    <span className="my-exam-online__when" data-testid="online-when">
      <span>
        <Typography.Text type="secondary">{t('takeExam.list.opensAt')}</Typography.Text>{' '}
        <Typography.Text>{item.scheduledAt ? formatZonedDateTime(item.scheduledAt, zone, language) : t('exams.drawer.noDate')}</Typography.Text>
      </span>
      {item.online.closesAt ? (
        <span>
          <Typography.Text type="secondary">{t('takeExam.list.closesAt')}</Typography.Text> <Typography.Text>{formatZonedDateTime(item.online.closesAt, zone, language)}</Typography.Text>
        </span>
      ) : null}
      {item.durationMinutes !== null ? (
        <Typography.Text type="secondary" style={SMALL}>
          {t('takeExam.list.attemptMinutes', { count: item.durationMinutes })}
        </Typography.Text>
      ) : null}
      {differsFromDevice(zone) ? (
        <span dir="ltr" style={{ ...SMALL, opacity: 0.65 }}>
          {zone}
        </span>
      ) : null}
    </span>
  )
}

/** Why the exam cannot be taken now, in words — the server's `blocker`, with the instant it is about. */
function blockedText(t: Translate, item: OnlineMyExamItem, language: Language): string {
  const { online } = item
  const when = (iso: string) => formatZonedDateTime(iso, item.timeZone, language)
  switch (online.blocker) {
    case 'not_open_yet':
      return item.scheduledAt ? t('takeExam.list.blocked.not_open_yet_at', { date: when(item.scheduledAt) }) : t('takeExam.list.blocked.not_open_yet')
    case 'closed':
      return online.closesAt ? t('takeExam.list.blocked.closed_at', { date: when(online.closesAt) }) : t('takeExam.list.blocked.closed')
    case 'attempts_exhausted':
      return t('takeExam.list.blocked.attempts_exhausted', { used: online.attemptsUsed, allowed: online.attemptsAllowed })
    case null:
      return t('takeExam.list.unavailable')
    default:
      return t(`takeExam.list.blocked.${online.blocker}`)
  }
}

interface ResumeControlProps {
  attempt: MyExamInProgress
  /** The countdown ran out, or the device's clocks disagree: the list should be read again. */
  onStale: () => void
}

/** «متابعة الاختبار» with the server's time left, counted down from the moment the list arrived. */
function ResumeControl({ attempt, onStale }: ResumeControlProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const arrivedAt = arrivalOf(attempt)
  const sync = useMemo<ClockSync | null>(() => (arrivedAt === null ? null : { remainingSeconds: attempt.remainingSeconds, at: arrivedAt }), [attempt, arrivedAt])
  // One re-read per answer of the list: this control is mounted anew with every answer (its key).
  const asked = useRef(false)
  const askOnce = () => {
    if (asked.current) return
    asked.current = true
    onStale()
  }
  // Without the moment of arrival the server's number is shown as it came.
  const seconds = useAttemptClock(sync, { active: true, onElapsed: askOnce, onDisagreement: askOnce }) ?? attempt.remainingSeconds
  if (seconds <= 0) {
    return (
      <Typography.Text type="secondary" role="status">
        {t('takeExam.list.timeOver')}
      </Typography.Text>
    )
  }
  const to = takeExamPath(attempt.id)
  return (
    <span className="my-exam-online__action">
      <Button
        type="primary"
        href={to}
        onClick={(event) => {
          // A real link that looks like a button: a plain click stays in the app, a modified one opens a tab.
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          navigate(to)
        }}
      >
        {t('takeExam.list.resume')}
      </Button>
      <span data-testid="resume-time-left">
        <Typography.Text type="secondary">{t('takeExam.list.timeLeft')}</Typography.Text>{' '}
        <strong>
          <bdi dir="ltr">{formatClock(seconds)}</bdi>
        </strong>
      </span>
    </span>
  )
}

interface OnlineTakeProps {
  item: OnlineMyExamItem
  /** «ابدأ الاختبار»: the page opens the confirmation. */
  onStart: (item: OnlineMyExamItem) => void
  /** The row's state is out of date: read the list again. */
  onStale: () => void
  /** The start button's words where the page has its own (the learner home); «ابدأ الاختبار» otherwise. */
  startLabel?: string
}

/** Under the exam's title: the questions, the attempts used, and the action or the reason. */
export function OnlineTake({ item, onStart, onStale, startLabel }: OnlineTakeProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { online } = item
  const state = takeStateOf(online)

  let action: ReactNode
  if (state.kind === 'resume') action = <ResumeControl key={`${state.attempt.id}:${online.serverNow}`} attempt={state.attempt} onStale={onStale} />
  else if (state.kind === 'start') {
    action = (
      <Button type="primary" onClick={() => onStart(item)}>
        {startLabel ?? t('takeExam.list.start')}
      </Button>
    )
  } else {
    action = (
      <Typography.Text type="secondary" className="my-exam-online__reason" data-testid="take-blocked">
        {blockedText(t, item, language)}
      </Typography.Text>
    )
  }

  return (
    // A span (the cell wraps its content in one): laid out as a column by its class.
    <span className="my-exam-online" data-testid="online-take">
      <Typography.Text type="secondary" style={SMALL}>
        {t('takeExam.list.questions', { count: online.questionCount })}
        {' · '}
        {t('takeExam.list.attemptsUsed', { used: online.attemptsUsed, allowed: online.attemptsAllowed })}
      </Typography.Text>
      {action}
    </span>
  )
}

interface OnlineResultProps {
  item: OnlineMyExamItem
  /** The result cell as a manual exam shows it (the released result, «after the publication», «none»). */
  released: ReactNode
}

/** The «result» cell: the released result as for any exam, then the student's attempts. */
export function OnlineResult({ item, released }: OnlineResultProps) {
  const { t } = useTranslation()
  const { online } = item
  const cell = onlineResultCellOf(item)
  return (
    <div className="my-exam-online__result">
      {cell.kind === 'afterSubmit' ? <Typography.Text type="secondary">{t('takeExam.list.result.afterSubmit')}</Typography.Text> : released}
      {online.attempts.length > 0 ? (
        <div className="my-exam-online__attempts">
          <Typography.Text type="secondary" style={SMALL}>
            {t('takeExam.list.attemptsTitle')}
          </Typography.Text>
          {/* A guardian reads the list; an attempt itself opens for its owner alone. */}
          <AttemptsList attempts={online.attempts} maxScore={item.maxScore} linked={item.relation === 'self'} unlinkedId={online.inProgress?.id ?? null} />
        </div>
      ) : null}
    </div>
  )
}
