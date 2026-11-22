// The «saved» line of the exam page's header (MOD-09 phase 2): answers save
// themselves, and the learner always sees where that stands — «يُحفظ…»,
// «حُفظت كل الإجابات», or «تعذّر الحفظ» with a retry. The visible line is not
// a live region (it would be read twice per answer); a hidden polite line
// speaks only when saving fails and when it works again.
import { CheckCircleOutlined, ExclamationCircleOutlined, LoadingOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SaveView } from './attemptSession'

interface SaveStatusProps {
  save: SaveView
  onRetry: () => void
}

/** What the hidden line says: nothing while saving goes well, the failure while it does not, then once that it works again. */
type Spoken = 'quiet' | 'failing' | 'recovered'

export function SaveStatus({ save, onRetry }: SaveStatusProps) {
  const { t } = useTranslation()
  const failing = save.state === 'retrying' || save.state === 'held'
  const [spoken, setSpoken] = useState<Spoken>('quiet')
  let next: Spoken = spoken
  if (failing) next = 'failing'
  else if (save.state === 'saved') next = spoken === 'failing' ? 'recovered' : spoken
  // A new change after the recovery: back to silence.
  else if (spoken === 'recovered') next = 'quiet'
  if (next !== spoken) setSpoken(next)

  let icon = <CheckCircleOutlined aria-hidden />
  if (save.state === 'saving') icon = <LoadingOutlined aria-hidden spin />
  else if (failing) icon = <ExclamationCircleOutlined aria-hidden />

  return (
    <div className={`take-save take-save--${save.state}`} data-testid="save-status" data-state={save.state}>
      {icon}
      <span className="take-save__text">{t(`takeExam.save.${save.state}`)}</span>
      {failing ? (
        <button type="button" className="take-link-button" onClick={onRetry}>
          {t('takeExam.save.retry')}
        </button>
      ) : null}
      <span className="take-sr-only" aria-live="polite" aria-atomic="true">
        {next === 'failing' ? t(`takeExam.save.${save.state === 'held' ? 'held' : 'retrying'}`) : next === 'recovered' ? t('takeExam.save.recovered') : ''}
      </span>
    </div>
  )
}
