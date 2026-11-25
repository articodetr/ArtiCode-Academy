// The confirmation before an attempt at an online exam starts (MOD-09 phase 2
// — API-276), opened by «ابدأ الاختبار» of a «my exams» row. It says the rules
// in plain words before the clock starts — the time limit, that the time runs
// on the server and does not stop when the page is left, that answers save
// themselves, which attempt this is, that the submit is final — and shows the
// exam's instructions. «ابدأ الآن» sends the attempt number the row showed
// (`attemptsUsed + 1`), so a repeated request — a slow network, a second
// click — never uses a second attempt: the server answers the attempt in
// progress, or 409 `attempt_conflict` when the numbers no longer match. On
// success the page moves to /take-exam/<id>, which reads the attempt itself.
// A refusal is worded here and the list behind is read again; only a failure
// that a second try may fix (the network, a 5xx, a 429) keeps «ابدأ الآن».
import { Alert, Button, Modal } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { startMyAttempt } from '../api/myAttempts'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { examTitle } from '../exams/exams.format'
import { myExamKey, takeStateOf } from '../exams/myExams.view'
import type { OnlineMyExamItem } from '../exams/myExams.view'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { describeTakeFailure, takeFailureMessage } from './takeExam.errors'
import type { TakeFailure } from './takeExam.errors'
import { takeExamPath } from './takeExam.format'
import './myExamOnline.css'

interface StartAttemptModalProps {
  /** The row of this session; null = closed. */
  item: OnlineMyExamItem | null
  onClose: () => void
  /** The server refused the start: the page reads its list again. */
  onRefused: () => void
  /** J-F67: the attempt started — the popup of a lesson's exam shows it in place; absent = go to /take-exam/<id>. */
  onStarted?: (attemptId: string) => void
}

/** Mounted per row, so every confirmation starts clean. */
export function StartAttemptModal({ item, onClose, onRefused, onStarted }: StartAttemptModalProps) {
  return <StartAttemptDialog key={item ? myExamKey(item) : 'closed'} item={item} onClose={onClose} onRefused={onRefused} onStarted={onStarted} />
}

function StartAttemptDialog({ item, onClose, onRefused, onStarted }: StartAttemptModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()
  const [starting, setStarting] = useState(false)
  const [failure, setFailure] = useState<TakeFailure | null>(null)
  // One request at a time: a second click on «ابدأ الآن» does nothing.
  const busy = useRef(false)

  if (item === null) return null

  const { online } = item
  const state = takeStateOf(online)
  // The number the row showed: the server refuses any other (409 attempt_conflict).
  const attemptNo = online.attemptsUsed + 1
  const last = state.kind === 'start' ? state.last : attemptNo >= online.attemptsAllowed
  const when = (iso: string) => formatZonedDateTime(iso, item.timeZone, language)
  const stopped = failure?.terminal === true

  const start = async () => {
    if (busy.current || stopped) return
    busy.current = true
    setStarting(true)
    setFailure(null)
    try {
      // A JSON integer or no field at all — the server refuses `attemptNo: null` (which is what a non-number would
      // become on the wire) with a 400.
      const attempt = await startMyAttempt(item.id, Number.isInteger(attemptNo) ? attemptNo : undefined)
      if (onStarted) onStarted(attempt.id)
      else navigate(takeExamPath(attempt.id))
    } catch (error) {
      setFailure(describeTakeFailure(error))
      // Any refusal of the server: the row behind this dialog is out of date.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) onRefused()
    } finally {
      busy.current = false
      setStarting(false)
    }
  }

  const close = () => {
    // The attempt may be starting on the server: stay until it answers.
    if (!starting) onClose()
  }

  return (
    <Modal
      open
      title={t('takeExam.start.title')}
      onCancel={close}
      closable={!starting}
      keyboard={!starting}
      mask={{ closable: !starting }}
      destroyOnHidden
      footer={
        stopped
          ? [
              <Button key="close" type="primary" onClick={close}>
                {t('takeExam.start.close')}
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={close} disabled={starting}>
                {t('takeExam.start.cancel')}
              </Button>,
              <Button key="start" type="primary" loading={starting} onClick={() => void start()} data-testid="start-now">
                {t('takeExam.start.ok')}
              </Button>,
            ]
      }
    >
      <p>{t('takeExam.start.intro', { title: examTitle(item, language) })}</p>
      <ul className="my-exam-start__rules">
        <li>{item.durationMinutes === null ? t('takeExam.start.rules.durationUnknown') : t('takeExam.start.rules.duration', { count: item.durationMinutes })}</li>
        {online.closesAt ? <li>{t('takeExam.start.rules.closes', { date: when(online.closesAt) })}</li> : null}
        <li>{t('takeExam.start.rules.questions', { count: online.questionCount })}</li>
        <li>{t('takeExam.start.rules.clock')}</li>
        <li>{t('takeExam.start.rules.autosave')}</li>
        <li>
          {t(last ? 'takeExam.start.rules.lastAttempt' : 'takeExam.start.rules.attempt', { number: attemptNo, allowed: online.attemptsAllowed })}
          {online.attemptsAllowed > 1 ? ` ${t('takeExam.start.rules.highestCounts')}` : null}
        </li>
        <li>{t('takeExam.start.rules.final')}</li>
      </ul>
      {item.description ? (
        <details className="my-exam-start__instructions">
          <summary>{t('takeExam.page.instructions')}</summary>
          {/* A plain element: antd Typography's RTL class would override dir="auto". */}
          <div dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
            {localizedLabel(item.description, language)}
          </div>
        </details>
      ) : null}
      {failure ? (
        <Alert
          type={stopped ? 'warning' : 'error'}
          showIcon
          title={takeFailureMessage(t, failure, when)}
          description={stopped ? t('takeExam.start.refreshed') : t('takeExam.start.retryHint')}
          style={{ marginTop: 16 }}
          data-testid="start-failure"
        />
      ) : null}
    </Modal>
  )
}
