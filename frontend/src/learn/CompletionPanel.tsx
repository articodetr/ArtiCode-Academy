// How the lesson completes, and whether it has (MOD-20 — D-R134), always as
// the server said: a manual lesson by the learner's «تحديد كمكتمل» (API-234 —
// idempotent; the answer moves the sidebar and the progress at once), a
// measured medium by playing the academy's share of it (the watched share is
// the server's — API-231, then each API-233 answer), a live lesson by
// attending a session that covers it. A completed lesson stays completed when
// the learner comes back to review it.
import { CheckCircleFilled } from '@ant-design/icons'
import { Alert, Button } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LearningItem } from '../api/learning'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import { actionFailureKey } from './learn.errors'

export interface CompletionPanelProps {
  item: LearningItem
  /** Sends API-234 and applies its answer; rejects with the server's refusal. */
  onComplete: (itemId: string) => Promise<void>
}

export function CompletionPanel({ item, onComplete }: CompletionPanelProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const progress = item.progress
  const completed = progress.state === 'completed'

  const complete = async () => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    try {
      await onComplete(item.id)
    } catch (error) {
      setFailure(actionFailureKey(error))
    } finally {
      setBusy(false)
    }
  }

  let rule: string | null = null
  if (item.completionMode === 'playback') rule = t('learn.completion.playbackRule', { percent: item.completionPercent })
  else if (item.completionMode === 'attendance') rule = t('learn.completion.attendanceRule')

  return (
    <section className="learn-card learn-completion" aria-live="polite">
      {completed ? (
        <div className="learn-completion__done">
          <CheckCircleFilled className="learn-completion__check" aria-hidden />
          <div>
            <strong>{t('learn.completion.completed')}</strong>
            {progress.completedAt ? (
              <span className="learn-muted learn-completion__date">{t('learn.completion.completedOn', { date: formatDateTime(progress.completedAt, language) })}</span>
            ) : null}
          </div>
        </div>
      ) : null}
      {rule && !completed ? <p className="learn-completion__rule">{rule}</p> : null}
      {item.completionMode === 'playback' && !completed && progress.watchedPercent !== null ? (
        <p className="learn-muted learn-completion__watched">{t('learn.completion.watched', { percent: progress.watchedPercent })}</p>
      ) : null}
      {item.completionMode === 'manual' && !completed ? (
        <Button type="primary" loading={busy} onClick={() => void complete()}>
          {t('learn.completion.markComplete')}
        </Button>
      ) : null}
      {failure ? <Alert className="learn-completion__error" type="error" showIcon title={t(failure)} /> : null}
    </section>
  )
}
