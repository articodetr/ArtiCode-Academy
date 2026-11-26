// A YouTube lesson inside the page, with how much of it the learner has watched
// (J-F64): the privacy-enhanced player, reopened where they stopped, and a bar
// of the part really played. Reaching the academy's share completes the lesson
// on the server. Since J-F69 (Jallal's reference of the lesson popup) the video
// sits in a dark frame; a video YouTube refuses to play here says so inside the
// frame — «صاحب الفيديو لا يسمح بتشغيله خارج موقع YouTube» when its owner turned
// embedding off (errors 101/150) — with a red «مشاهدة على YouTube»; the same link
// sits under the frame, and «المشاهدة المحتسبة: 00:04 من 01:00 (6٪)» under it is
// the part this device really played (the bar too, full once the lesson is
// completed; the completion panel says when it was).
import { ExportOutlined } from '@ant-design/icons'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LearningItem } from '../api/learning'
import { useAuth } from '../auth/auth-context'
import { formatClockDuration, isHttpsUrl } from './learn.format'
import { useYouTubeProgress } from './useYouTubeProgress'
import { readWatched, resumeSecondsOf } from './watched.store'
import { trackedYoutubeEmbedUrl } from './youtube.bridge'

/** The player's errors for a video whose owner does not allow it to play on other sites. */
const OWNER_REFUSED = new Set([101, 150])

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
  // A completed lesson reads as full on the bar, however it was completed (the learner may have pressed the button);
  // the line keeps the part this device measured.
  const shownPercent = completed ? 100 : percent
  const watched = formatClockDuration(watch.watchedSeconds, { padMinutes: true })
  const total = formatClockDuration(watch.durationSeconds, { padMinutes: true })
  const link = isHttpsUrl(watchUrl) ? watchUrl : null
  const blocked = watch.errorCode !== null

  return (
    <div className="learn-media learn-youtube">
      <div className={`learn-embed learn-embed--framed${blocked ? ' is-blocked' : ''}`}>
        <iframe
          ref={frameRef}
          src={src}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
        {blocked ? (
          <div className="learn-embed__blocked" role="alert">
            <p>{t(OWNER_REFUSED.has(watch.errorCode ?? 0) ? 'learn.lesson.watch.blockedOwner' : 'learn.lesson.watch.blocked')}</p>
            {link ? (
              <a className="learn-youtube__button" href={link} target="_blank" rel="noopener noreferrer">
                {t('learn.lesson.watch.openOnYouTube')}
                <span className="learn-sr-only"> {t('learn.lesson.newTab')}</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      {link ? (
        <a className="learn-youtube__link" href={link} target="_blank" rel="noopener noreferrer">
          <ExportOutlined aria-hidden /> {t('learn.lesson.watch.openOnYouTube')}
          <span className="learn-sr-only"> {t('learn.lesson.newTab')}</span>
        </a>
      ) : null}
      <div className={`learn-watch${completed ? ' learn-watch--done' : ''}`}>
        <p className="learn-watch__line">
          <strong>{t('learn.lesson.watch.counted')}</strong>{' '}
          {watch.percent !== null && watched && total ? (
            <span className="learn-watch__value">
              <bdi dir="ltr">{watched}</bdi> {t('learn.lesson.watch.of')} <bdi dir="ltr">{total}</bdi> {t('learn.lesson.watch.share', { percent })}
            </span>
          ) : watch.percent !== null ? (
            <span className="learn-watch__value">{t('learn.lesson.watch.share', { percent })}</span>
          ) : completed ? (
            <span className="learn-watch__value">{t('learn.lesson.watch.done')}</span>
          ) : (
            <span className="learn-muted">{t('learn.lesson.watch.notStarted')}</span>
          )}
        </p>
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
