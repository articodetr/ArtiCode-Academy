// Where the learner stands in the lesson (MOD-20 — D-R134), always as the server
// said: «مكتمل» once the lesson is completed, else the watched share of a
// measured medium (API-231, then each API-233 answer). There is no button: a
// video completes itself — a file video or audio by its watched share, a
// YouTube video through `useYouTubeProgress` (API-234 when the share is
// reached) — and a live lesson by attending its session (AHMED-TT-1, the
// learner's page shows the lesson, its progress and the way on only).
// Shows nothing while there is nothing to say.
import { CheckCircleFilled } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { LearningItem } from '../api/learning'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'

export interface CompletionPanelProps {
  item: LearningItem
}

export function CompletionPanel({ item }: CompletionPanelProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const progress = item.progress
  const completed = progress.state === 'completed'
  const watched = item.completionMode === 'playback' && !completed && progress.watchedPercent !== null

  if (!completed && !watched) return null

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
      ) : (
        <p className="learn-muted learn-completion__watched">{t('learn.completion.watched', { percent: progress.watchedPercent })}</p>
      )}
    </section>
  )
}
