// One question of an attempt in progress (MOD-09 phase 2): its number out of
// the total, its points, the prompt, and its choices as ONE radio group
// labelled by the prompt — the options of a `single_choice` question, «صحيح» /
// «خطأ» for a `true_false` one — plus «مسح الإجابة». Native radio buttons, so
// the arrow keys move inside the group and Tab leaves it; each choice is a
// full-width label, easy to hit on a phone.
//
// It renders the question and the learner's own answer, and NOTHING else: it
// never reads `question.review` — no grading and no correct-answer mark exist
// on this screen (SEC-R-24).
import { useId } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { AttemptQuestion } from '../api/myAttempts'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { isAnswered, radioValueOf } from './takeExam.answers'
import type { LocalAnswer } from './takeExam.answers'
import { choicesOf } from './takeExam.format'

interface QuestionCardProps {
  question: Pick<AttemptQuestion, 'id' | 'type' | 'points' | 'prompt' | 'options'>
  /** 1-based position in the exam's order. */
  number: number
  total: number
  /** The answer on screen. */
  answer: LocalAnswer | undefined
  /** True once answers are no longer taken (the submit is running, or the time is over). */
  disabled: boolean
  /** The whole new answer of this question; null clears it. */
  onAnswer: (answer: LocalAnswer) => void
  /** The heading takes the focus when the learner moves to this question. */
  headingRef: RefObject<HTMLHeadingElement | null>
}

export function QuestionCard({ question, number, total, answer, disabled, onAnswer, headingRef }: QuestionCardProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const headingId = useId()
  const promptId = useId()
  const choices = choicesOf(question, { trueOption: t('takeExam.question.trueOption'), falseOption: t('takeExam.question.falseOption') }, language)
  const selected = radioValueOf(answer)
  const answered = isAnswered(answer)

  return (
    <section className="take-card take-question" aria-labelledby={headingId} data-testid="question-card">
      <div className="take-question__head">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="take-question__heading">
          {t('takeExam.question.heading', { number, total })}
        </h2>
        <span className="take-question__points">{t('takeExam.question.points', { points: question.points })}</span>
      </div>

      {/* A plain element: `dir="auto"` follows the prompt's own language (antd Typography's RTL class would override it). */}
      <div id={promptId} className="take-prompt" dir="auto">
        {localizedLabel(question.prompt, language)}
      </div>

      {choices.length > 0 ? (
        <div role="radiogroup" aria-labelledby={promptId} className="take-options">
          {choices.map((choice) => (
            <label key={choice.value} className={`take-option${selected === choice.value ? ' take-option--selected' : ''}${disabled ? ' take-option--disabled' : ''}`}>
              <input
                type="radio"
                className="take-option__input"
                // One name per question: the browser's own arrow-key group.
                name={`take-question-${question.id}`}
                value={choice.value}
                checked={selected === choice.value}
                disabled={disabled}
                onChange={() => onAnswer(choice.answer)}
              />
              <span className="take-option__text">
                <bdi>{choice.label}</bdi>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="take-muted">{t('takeExam.question.noOptions')}</p>
      )}

      <div className="take-question__foot">
        <button
          type="button"
          className="take-link-button"
          // Kept focusable while there is nothing to clear, so the focus is not lost after a clear.
          aria-disabled={!answered || disabled}
          disabled={disabled}
          onClick={() => {
            if (answered && !disabled) onAnswer(null)
          }}
        >
          {t('takeExam.question.clear')}
        </button>
      </div>
    </section>
  )
}
