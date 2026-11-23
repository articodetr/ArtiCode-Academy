// A learner's attempts at one online exam (MOD-09 phase 2 — `AttemptSummaryDto`
// of API-121 and API-277): the number, the status, the score ONLY when the
// server sent one (it does once the result is released — D-R156), and a link
// to /take-exam/<id>. A guardian's list has no links: an attempt is read by
// its owner alone (anybody else gets 404).
import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { AttemptSummary } from '../api/myAttempts'
import { scoreText } from '../assignments/myAssignments.view'
import { ATTEMPT_STATUS_COLORS, isFinishedAttempt, takeExamPath } from './takeExam.format'
import './attemptsList.css'

interface AttemptsListProps {
  attempts: readonly AttemptSummary[]
  /** The exam's maximum score, for «8 / 10». */
  maxScore: number
  /** True for the learner's own attempts; false for a guardian's view of a child's. */
  linked: boolean
  /** The attempt on screen (the exam page): marked instead of linked. */
  currentId?: string
  /** An attempt that has its own control beside the list (the «continue» button of «my exams»): not linked twice. */
  unlinkedId?: string | null
}

export function AttemptsList({ attempts, maxScore, linked, currentId, unlinkedId }: AttemptsListProps) {
  const { t } = useTranslation()
  if (attempts.length === 0) return null
  return (
    <ul className="take-attempts" data-testid="attempts-list">
      {attempts.map((attempt) => {
        const finished = isFinishedAttempt(attempt)
        return (
          <li key={attempt.id} className="take-attempts__item">
            <span className="take-attempts__name">{t('takeExam.list.attempt', { number: attempt.attemptNo })}</span>
            <Tag color={ATTEMPT_STATUS_COLORS[attempt.status]}>{t(`takeExam.list.attemptStatus.${attempt.status}`)}</Tag>
            {attempt.score !== null ? (
              <strong>
                <bdi dir="ltr">{scoreText(attempt.score, maxScore)}</bdi>
              </strong>
            ) : null}
            {attempt.id === currentId ? <Tag>{t('takeExam.attempts.current')}</Tag> : null}
            {linked && attempt.id !== currentId && attempt.id !== unlinkedId ? (
              <Link to={takeExamPath(attempt.id)} aria-label={t(finished ? 'takeExam.list.viewAttemptOf' : 'takeExam.list.openAttemptOf', { number: attempt.attemptNo })}>
                {t(finished ? 'takeExam.list.viewAttempt' : 'takeExam.list.openAttempt')}
              </Link>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
