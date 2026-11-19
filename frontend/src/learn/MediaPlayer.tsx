// A measured medium of a lesson (MOD-20, D-R134): a `file` video or an audio
// lesson in the browser's own player — `controls`, `preload="metadata"`, a
// speed selector, the captions of a video as `<track kind="captions">`, the
// learner's last position from the server — tracked by usePlaybackTracker
// when the lesson completes by playback. A cross-origin caption file needs
// the medium fetched with CORS (`crossOrigin="anonymous"`); a host that does
// not allow it is retried once without (and without the captions) before the
// player gives way to a calm notice. A media error never leaves a broken player.
import { Alert, Segmented } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Caption, PlaybackResult } from '../api/learning'
import { isHttpsUrl } from './learn.format'
import { usePlaybackTracker } from './usePlaybackTracker'

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const

export interface MediaPlayerProps {
  kind: 'video' | 'audio'
  itemId: string
  src: string
  /** Accessible name of the player (the lesson's title). */
  title: string
  captions?: readonly Caption[]
  /** True when the lesson completes by playback (API-233 is then called). */
  tracked: boolean
  /** Where the learner stopped last time (API-231 progress.positionSeconds). */
  startPosition: number | null
  onSaved: (result: PlaybackResult) => void
}

export function MediaPlayer({ kind, itemId, src, title, captions = [], tracked, startPosition, onSaved }: MediaPlayerProps) {
  const { t } = useTranslation()
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const usableCaptions = kind === 'video' ? captions.filter((caption) => isHttpsUrl(caption.url)) : []
  const [withCors, setWithCors] = useState(usableCaptions.length > 0)
  const [failed, setFailed] = useState(false)
  const [rate, setRate] = useState<number>(1)
  const resumed = useRef(false)
  const corsRetried = useRef(false)

  usePlaybackTracker({ mediaRef, itemId, enabled: tracked && !failed, startPosition, onSaved })

  useEffect(() => {
    // Retried without CORS: the browser reloads the medium only when asked.
    if (corsRetried.current && !withCors) mediaRef.current?.load()
  }, [withCors])

  useEffect(() => {
    const media = mediaRef.current
    if (!media) return
    media.defaultPlaybackRate = rate
    media.playbackRate = rate
  }, [rate])

  const setMedia = useCallback((element: HTMLMediaElement | null) => {
    mediaRef.current = element
  }, [])

  if (failed) return <Alert type="info" showIcon title={t('learn.lesson.mediaError')} />

  const onLoadedMetadata = () => {
    const media = mediaRef.current
    if (!media) return
    media.playbackRate = rate
    if (resumed.current) return
    resumed.current = true
    const duration = Number.isFinite(media.duration) ? media.duration : null
    if (startPosition !== null && startPosition > 0 && (duration === null || startPosition < duration - 2)) media.currentTime = startPosition
  }
  const onError = () => {
    if (withCors && !corsRetried.current) {
      corsRetried.current = true
      setWithCors(false)
      return
    }
    setFailed(true)
  }

  const common = {
    ref: setMedia,
    src,
    controls: true,
    preload: 'metadata',
    title,
    'aria-label': title,
    crossOrigin: withCors ? ('anonymous' as const) : undefined,
    onLoadedMetadata,
    onError,
  }

  return (
    <div className="learn-media">
      {kind === 'video' ? (
        <video {...common} className="learn-media__video" playsInline>
          {withCors
            ? usableCaptions.map((caption) => (
                <track
                  key={`${caption.language}:${caption.url}`}
                  kind="captions"
                  src={caption.url}
                  srcLang={caption.language}
                  label={caption.label ?? t(`learn.lesson.captions.${caption.language}`)}
                />
              ))
            : null}
        </video>
      ) : (
        <audio {...common} className="learn-media__audio" />
      )}
      <div className="learn-media__speed">
        <span id={`learn-speed-${itemId}`} className="learn-muted">
          {t('learn.lesson.speed')}
        </span>
        <Segmented<number>
          size="small"
          value={rate}
          onChange={(value) => setRate(value)}
          aria-labelledby={`learn-speed-${itemId}`}
          options={PLAYBACK_RATES.map((value) => ({ value, label: <bdi dir="ltr">{`${value}×`}</bdi> }))}
        />
      </div>
    </div>
  )
}
