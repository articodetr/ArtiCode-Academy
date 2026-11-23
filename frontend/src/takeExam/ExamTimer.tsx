// The timer of the exam page's header (MOD-09 phase 2 — D-R152). It shows the
// SERVER's time left: the running clock handed to it (takeExam.clock.ts) and
// the monotonic clock of the device — never the device's date. `mm:ss`
// (`h:mm:ss` from one hour), a calm warning under five minutes and a stronger
// one under one. The digits sit in a `role="timer"` (not a live region), so a
// screen reader is not told every second; a hidden polite line says the
// minutes left once a minute — which includes the two thresholds — and
// «the time is over» at zero.
import { ClockCircleOutlined } from '@ant-design/icons'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { clockLevel, formatClock, spokenMinutes } from './takeExam.clock'
import type { ClockSync } from './takeExam.clock'
import { useAttemptClock } from './useAttemptClock'

interface ExamTimerProps {
  /** The running clock; null hides the timer. */
  sync: ClockSync | null
  /** False once answers are no longer taken: the ticking stops. */
  active: boolean
  /** The clock is at zero. */
  onElapsed: () => void
  /** The device's two clocks disagree: the server should be asked again. */
  onDisagreement: () => void
}

export function ExamTimer({ sync, active, onElapsed, onDisagreement }: ExamTimerProps) {
  const { t } = useTranslation()
  const labelId = useId()
  const seconds = useAttemptClock(sync, { active, onElapsed, onDisagreement })
  if (seconds === null) return null
  const level = clockLevel(seconds)
  const minutes = spokenMinutes(seconds)
  return (
    <div className={`take-timer take-timer--${level}`} data-testid="exam-timer" data-level={level}>
      <ClockCircleOutlined aria-hidden className="take-timer__icon" />
      <span id={labelId} className="take-timer__label">
        {t('takeExam.timer.label')}
      </span>
      <span role="timer" aria-labelledby={labelId} className="take-timer__value">
        <bdi dir="ltr">{formatClock(seconds)}</bdi>
      </span>
      <span className="take-sr-only" aria-live="polite" aria-atomic="true" data-testid="exam-timer-spoken">
        {/* Zero has its own sentence in every language (English has no «zero» plural form). */}
        {minutes === 0 ? t('takeExam.timer.over') : t('takeExam.timer.spoken', { count: minutes })}
      </span>
    </div>
  )
}
