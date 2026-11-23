// A finished attempt (`submitted` or `timed_out`) as its learner may see it
// (MOD-09 phase 2 — D-R156, D-R157). Everything about the outcome is the
// server's, shown only when it sent it:
//
// - `result` present → the score, the correct answers out of the questions,
//   pass / below the pass score when the exam names one, and whether this
//   attempt is the one that counts. `result` null → «نتيجتك تظهر عندما ينشر
//   المعلم النتائج», and no number at all.
// - the questions with the learner's own saved answers; a question whose
//   `review` is present also shows right / wrong, the points earned, the
//   option the server named as correct and its explanation. Without any
//   `review`: a note when the exam will reveal its answers later, else nothing
//   about correct answers.
//
// Nothing is computed here: no score, no pass mark, no «correct» — the page
// reads what the server wrote.
import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons'
import { Alert, Tag } from 'antd'
import { useId } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { AttemptQuestion, MyAttempt } from '../api/myAttempts'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { differsFromDevice } from '../assignments/assignments.zone'
import { scoreText } from '../assignments/myAssignments.view'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import type { EndedBy } from './attemptSession'
import { AttemptsList } from './AttemptsList'
import { isAnswered, radioValueOf } from './takeExam.answers'
import { MY_EXAMS_ROUTE, choicesOf, correctValueOf } from './takeExam.format'

interface FinishedQuestionProps {
  question: AttemptQuestion
  number: number
}

function FinishedQuestion({ question, number }: FinishedQuestionProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const review = question.review
  const choices = choicesOf(question, { trueOption: t('takeExam.question.trueOption'), falseOption: t('takeExam.question.falseOption') }, language)
  const chosen = radioValueOf(question.answer)
  // The server's word, or null: nothing is marked as correct before it says so.
  const correct = correctValueOf(question)

  return (
    <li className="take-answer" data-testid="finished-question">
      <div className="take-answer__head">
        <h4 className="take-answer__number">{t('takeExam.answers.question', { number })}</h4>
        {review ? (
          <Tag color={review.isCorrect ? 'green' : 'red'} icon={review.isCorrect ? <CheckCircleFilled aria-hidden /> : <CloseCircleFilled aria-hidden />} data-testid="question-grade">
            {t(review.isCorrect ? 'takeExam.answers.correct' : 'takeExam.answers.wrong')}
          </Tag>
        ) : null}
      </div>
      <div className="take-prompt" dir="auto">
        {localizedLabel(question.prompt, language)}
      </div>
      <ul className="take-answer__options">
        {choices.map((choice) => {
          const isChosen = choice.value === chosen
          const isCorrect = correct !== null && choice.value === correct
          return (
            <li key={choice.value} className={`take-answer__option${isChosen ? ' take-answer__option--chosen' : ''}${isCorrect ? ' take-answer__option--correct' : ''}`}>
              <span className="take-answer__dot" aria-hidden />
              <span className="take-answer__text">
                <bdi>{choice.label}</bdi>
              </span>
              {isChosen ? <Tag color="blue">{t('takeExam.answers.yourChoice')}</Tag> : null}
              {isCorrect ? (
                <Tag color="green" data-testid="correct-answer-mark">
                  {t('takeExam.answers.correctAnswer')}
                </Tag>
              ) : null}
            </li>
          )
        })}
      </ul>
      {isAnswered(question.answer) ? null : <p className="take-muted">{t('takeExam.answers.notAnswered')}</p>}
      {review ? (
        <p className="take-answer__points">
          {t('takeExam.answers.pointsAwarded')} <bdi dir="ltr">{scoreText(review.pointsAwarded, question.points)}</bdi>
        </p>
      ) : null}
      {review?.explanation ? (
        <div className="take-answer__explanation">
          <strong>{t('takeExam.answers.explanation')}</strong>
          <div dir="auto" className="take-prompt">
            {localizedLabel(review.explanation, language)}
          </div>
        </div>
      ) : null}
    </li>
  )
}

interface AttemptFinishedProps {
  attempt: MyAttempt
  /** Why the attempt ended while this page was open; null when it was opened already finished. */
  endedBy: EndedBy | null
  /** Positions (1-based) of the answers whose last change never reached the server. */
  lostAnswers: readonly number[]
  /** The heading takes the focus when the attempt ends on this page. */
  headingRef: RefObject<HTMLHeadingElement | null>
}

export function AttemptFinished({ attempt, endedBy, lostAnswers, headingRef }: AttemptFinishedProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const headingId = useId()
  const resultId = useId()
  const answersId = useId()
  const attemptsId = useId()
  const { exam, result } = attempt
  const zone = exam.timeZone
  const when = (iso: string) => formatZonedDateTime(iso, zone, language)
  const timedOut = attempt.status === 'timed_out'
  const reviewed = attempt.questions.some((question) => question.review !== null)
  const severalAttempts = attempt.attempts.length > 1 || exam.attemptsAllowed > 1

  let pendingReview: string | null = null
  if (!reviewed && exam.revealAnswers) {
    if (!attempt.resultReleased) pendingReview = t('takeExam.answers.pendingPublish')
    else pendingReview = exam.closesAt ? t('takeExam.answers.pendingCloseAt', { date: when(exam.closesAt) }) : t('takeExam.answers.pendingClose')
  }

  return (
    <div className="take-finished" data-testid="attempt-finished">
      <section className="take-card" aria-labelledby={headingId}>
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="take-finished__heading">
          {timedOut || endedBy === 'clock' ? t('takeExam.finished.timedOutTitle') : t('takeExam.finished.submittedTitle')}
        </h2>
        <p className="take-finished__status" data-testid="finished-status">
          {timedOut ? t('takeExam.finished.timedOut') : attempt.submittedAt ? t('takeExam.finished.submittedAt', { date: when(attempt.submittedAt) }) : null}
          {attempt.submittedAt && !timedOut && differsFromDevice(zone) ? (
            <>
              {' '}
              <span dir="ltr" className="take-zone">
                ({zone})
              </span>
            </>
          ) : null}
        </p>
        {endedBy === 'clock' && !timedOut ? <Alert type="info" showIcon title={t('takeExam.finished.endedByClock')} /> : null}
        {endedBy === 'elsewhere' ? <Alert type="warning" showIcon title={t('takeExam.finished.endedElsewhere')} /> : null}
        {lostAnswers.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            title={t('takeExam.finished.lostAnswers', {
              list: lostAnswers.map((number) => t('takeExam.answers.question', { number })).join(t('takeExam.finished.lostSeparator')),
            })}
            data-testid="lost-answers"
          />
        ) : null}
      </section>

      <section className="take-card take-result" aria-labelledby={resultId} data-testid="attempt-result">
        <h3 id={resultId} className="take-section-title">
          {t('takeExam.result.title')}
        </h3>
        {result ? (
          <>
            <dl className="take-result__facts">
              <div>
                <dt>{t('takeExam.result.score')}</dt>
                <dd className="take-result__score" data-testid="result-score">
                  <bdi dir="ltr">{scoreText(result.score, result.maxScore)}</bdi>
                </dd>
              </div>
              <div>
                <dt>{t('takeExam.result.correct')}</dt>
                <dd data-testid="result-correct">
                  <bdi dir="ltr">{scoreText(result.correctCount, result.questionCount)}</bdi>
                </dd>
              </div>
              {exam.passScore !== null ? (
                <div>
                  <dt>{t('takeExam.result.passScore')}</dt>
                  <dd>
                    <bdi dir="ltr">{exam.passScore}</bdi>
                  </dd>
                </div>
              ) : null}
            </dl>
            {result.isPass !== null ? (
              <Tag color={result.isPass ? 'green' : 'red'} data-testid="result-pass">
                {t(result.isPass ? 'takeExam.result.passed' : 'takeExam.result.failed')}
              </Tag>
            ) : null}
            {severalAttempts ? <p className="take-result__counted">{t(result.counted ? 'takeExam.result.counted' : 'takeExam.result.notCounted')}</p> : null}
          </>
        ) : (
          <p data-testid="result-awaiting">{t('takeExam.result.awaiting')}</p>
        )}
      </section>

      {attempt.questions.length > 0 ? (
        <section className="take-card" aria-labelledby={answersId} data-testid={reviewed ? 'attempt-review' : 'attempt-answers'}>
          <h3 id={answersId} className="take-section-title">
            {t(reviewed ? 'takeExam.answers.reviewTitle' : 'takeExam.answers.title')}
          </h3>
          {pendingReview ? (
            <p className="take-muted" data-testid="review-pending">
              {pendingReview}
            </p>
          ) : null}
          <ol className="take-answers">
            {attempt.questions.map((question, index) => (
              <FinishedQuestion key={question.id} question={question} number={index + 1} />
            ))}
          </ol>
        </section>
      ) : null}

      {attempt.attempts.length > 1 ? (
        <section className="take-card" aria-labelledby={attemptsId}>
          <h3 id={attemptsId} className="take-section-title">
            {t('takeExam.attempts.title')}
          </h3>
          <AttemptsList attempts={attempt.attempts} maxScore={exam.maxScore} linked currentId={attempt.id} />
        </section>
      ) : null}

      <p>
        <Link to={MY_EXAMS_ROUTE} className="take-back-link">
          {t('takeExam.page.back')}
        </Link>
      </p>
    </div>
  )
}
