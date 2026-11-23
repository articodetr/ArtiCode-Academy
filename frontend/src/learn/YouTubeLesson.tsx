// A YouTube lesson inside the page, with how much of it the learner has watched
// (J-F64): the privacy-enhanced player, reopened where they stopped, and a bar
// of the part really played. Reaching the academy's share completes the lesson
// on the server. A video YouTube refuses to play here gets a clear message and
// a link to watch it there.
import { CheckCircleFilled, ExportOutlined } from '@ant-design/icons'
import { Alert, Button } from 'antd'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LearningItem } from '../api/learning'
import { useAuth } from '../auth/auth-context'
import { formatClockDuration, isHttpsUrl } from './learn.format'
import { useYouTubeProgress } from './useYouTubeProgress'
import { readWatched, resumeSecondsOf } from './watched.store'
import { trackedYoutubeEmbedUrl } from './youtube.bridge'

export interface YouTubeLessonProps {
  item: LearningItem
  videoId: string
  /** The address of the video on YouTube. */
  watchUrl: string
  title: string
  onComplete: (itemId: string) => Promise<void>
}

export function YouTubeLesson({ item, videoId, watchUrl, title, onComplete }: YouTubeLessonProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const userId = user?.id ?? 'anonymous'
  const itemId = item.id
  const frameRef = useRef<HTMLIFrameElement>(null)
  // Fixed for this opening: a new address would reload the player in the middle of the lesson.
  const [src] = useState(() => trackedYoutubeEmbedUrl(videoId, window.location.origin, resumeSecondsOf(readWatched(userId, itemId))))
  const completed = item.progress.state === 'completed'
  const onReached = useCallback(() => onComplete(itemId), [onComplete, itemId])
  const watch = useYouTubeProgress({ frameRef, userId, itemId, completionPercent: item.completionPercent, completed, onReached })
  const percent = watch.percent ?? 0
  // A completed lesson reads as full, however it was completed (the learner may have pressed the button).
  const shownPercent = completed ? 100 : percent
  const watched = formatClockDuration(watch.watchedSeconds)
  const total = formatClockDuration(watch.durationSeconds)

  return (
    <div className="learn-media">
      <div className="learn-embed">
        <iframe
          ref={frameRef}
          src={src}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      {watch.errorCode !== null ? (
        <Alert
          type="warning"
          showIcon
          title={t('learn.lesson.watch.blocked')}
          action={
            isHttpsUrl(watchUrl) ? (
              <Button size="small" icon={<ExportOutlined aria-hidden />} href={watchUrl} target="_blank" rel="noopener noreferrer">
                {t('learn.lesson.watch.openOnYouTube')}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      <div className={`learn-watch${completed ? ' learn-watch--done' : ''}`}>
        <div className="learn-watch__line">
          {completed ? (
            <strong>
              <CheckCircleFilled aria-hidden /> {t('learn.lesson.watch.done')}
            </strong>
          ) : watch.percent === null ? (
            <span>{t('learn.lesson.watch.notStarted')}</span>
          ) : (
            <strong>{t('learn.lesson.watch.percent', { percent })}</strong>
          )}
          {watch.percent !== null && watched && total ? (
            <span className="learn-muted">
              <bdi dir="ltr">{watched}</bdi> {t('learn.lesson.watch.of')} <bdi dir="ltr">{total}</bdi>
            </span>
          ) : null}
        </div>
        <div
          className="learn-watch__track"
          role="progressbar"
          aria-label={t('learn.lesson.watch.label')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={shownPercent}
        >
          <div className="learn-watch__fill" style={{ inlineSize: `${shownPercent}%` }} />
        </div>
        {completed ? null : <p className="learn-muted learn-watch__rule">{t('learn.lesson.watch.rule', { percent: item.completionPercent })}</p>}
      </div>
    </div>
  )
}
