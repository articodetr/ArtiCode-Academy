// «مراجعة وتسليم» of an attempt in progress (MOD-09 phase 2): how many
// questions hold an answer, each unanswered one as a button back to it, where
// the saving stands, and the final «تسليم الاختبار» — which the page confirms
// before it calls the server. It counts the learner's own answers; it says
// nothing about which of them is right.
import { CheckCircleOutlined } from '@ant-design/icons'
import { Alert, Button } from 'antd'
import { useId } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { AttemptQuestion } from '../api/myAttempts'
import type { SaveView } from './attemptSession'
import { unansweredNumbers } from './takeExam.answers'
import type { AnswerMap } from './takeExam.answers'

interface ReviewPanelProps {
  questions: readonly Pick<AttemptQuestion, 'id'>[]
  answers: AnswerMap
  save: SaveView
  /** The confirmed submit is running: the answers are locked. */
  submitting: boolean
  onBack: () => void
  /** Back to one question (its index). */
  onPick: (index: number) => void
  /** «تسليم الاختبار»: the page asks for the final confirmation. */
  onSubmit: () => void
  headingRef: RefObject<HTMLHeadingElement | null>
}

export function ReviewPanel({ questions, answers, save, submitting, onBack, onPick, onSubmit, headingRef }: ReviewPanelProps) {
  const { t } = useTranslation()
  const headingId = useId()
  const unanswered = unansweredNumbers(questions, answers)
  const total = questions.length
  const failing = save.state === 'retrying' || save.state === 'held'

  return (
    <section className="take-card take-review" aria-labelledby={headingId} data-testid="review-panel">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="take-review__heading">
        {t('takeExam.review.title')}
      </h2>
      <p className="take-review__summary">{t('takeExam.review.summary', { answered: total - unanswered.length, total })}</p>

      {unanswered.length === 0 ? (
        <p className="take-review__complete">
          <CheckCircleOutlined aria-hidden /> {t('takeExam.review.allAnswered')}
        </p>
      ) : (
        <div className="take-review__unanswered">
          <p>{t('takeExam.review.unanswered', { count: unanswered.length })}</p>
          <ul className="take-review__list">
            {unanswered.map((number) => (
              <li key={number}>
                <Button size="small" disabled={submitting} onClick={() => onPick(number - 1)}>
                  {t('takeExam.review.questionButton', { number })}
                </Button>
              </li>
            ))}
          </ul>
          <p className="take-muted">{t('takeExam.review.unansweredHint')}</p>
        </div>
      )}

      {failing ? <Alert type="warning" showIcon title={t('takeExam.review.unsavedWarning')} /> : null}
      {submitting && save.unsaved ? <p className="take-muted">{t('takeExam.review.waitingSave')}</p> : null}

      <div className="take-actions">
        <Button onClick={onBack} disabled={submitting}>
          {t('takeExam.review.back')}
        </Button>
        <Button type="primary" loading={submitting} onClick={onSubmit} data-testid="submit-exam">
          {submitting ? t('takeExam.submit.submitting') : t('takeExam.submit.button')}
        </Button>
      </div>
    </section>
  )
}
