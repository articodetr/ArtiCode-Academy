// The navigator of an attempt in progress (MOD-09 phase 2): one numbered
// button per question, showing whether it is answered and which one is open.
// Real buttons in the exam's order, so Tab walks them; each names itself to a
// screen reader («السؤال 3، مُجاب») and the open one carries `aria-current`.
// Answered / unanswered differ by fill, not by colour alone, and a legend says
// what the marks mean.
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { AttemptQuestion } from '../api/myAttempts'
import { answeredCount, questionMark } from './takeExam.answers'
import type { AnswerMap } from './takeExam.answers'

interface QuestionNavigatorProps {
  questions: readonly Pick<AttemptQuestion, 'id'>[]
  answers: AnswerMap
  /** Index of the question on screen; null while the review is shown. */
  current: number | null
  onPick: (index: number) => void
}

export function QuestionNavigator({ questions, answers, current, onPick }: QuestionNavigatorProps) {
  const { t } = useTranslation()
  const titleId = useId()
  return (
    <nav className="take-card take-navigator" aria-labelledby={titleId} data-testid="question-navigator">
      <div className="take-navigator__head">
        <h2 id={titleId} className="take-navigator__title">
          {t('takeExam.navigator.title')}
        </h2>
        <span className="take-muted" data-testid="answered-progress">
          {t('takeExam.navigator.progress', { answered: answeredCount(questions, answers), total: questions.length })}
        </span>
      </div>
      <ol className="take-navigator__list">
        {questions.map((question, index) => {
          const mark = questionMark(answers.get(question.id))
          return (
            <li key={question.id}>
              <button
                type="button"
                className={`take-navigator__button take-navigator__button--${mark}`}
                aria-label={t(`takeExam.navigator.${mark}`, { number: index + 1 })}
                aria-current={index === current ? 'true' : undefined}
                data-mark={mark}
                onClick={() => onPick(index)}
              >
                {index + 1}
              </button>
            </li>
          )
        })}
      </ol>
      <ul className="take-navigator__legend" aria-hidden>
        <li>
          <span className="take-navigator__swatch take-navigator__swatch--answered" />
          {t('takeExam.navigator.legendAnswered')}
        </li>
        <li>
          <span className="take-navigator__swatch take-navigator__swatch--unanswered" />
          {t('takeExam.navigator.legendUnanswered')}
        </li>
        <li>
          <span className="take-navigator__swatch take-navigator__swatch--current" />
          {t('takeExam.navigator.legendCurrent')}
        </li>
      </ul>
    </nav>
  )
}
