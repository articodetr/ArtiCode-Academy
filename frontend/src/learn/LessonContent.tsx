// The content of one lesson by its kind (MOD-20 — D-R131): only what the
// server returned, nothing invented. Plain text is rendered as text — split
// into paragraphs on blank lines, its line breaks kept by `white-space:
// pre-line`, never as HTML. Every address must be https (the server's rule;
// anything else is not rendered). An external video plays in the provider's
// privacy-enhanced player; a PDF opens in a new tab (the page's CSP does not
// frame documents); a missing or unreadable content is a calm notice.
import { DownloadOutlined, ExportOutlined, FilePdfOutlined, PaperClipOutlined } from '@ant-design/icons'
import { Alert, Button } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AudioContent,
  FileContent,
  ImageContent,
  LearningItem,
  LiveContent,
  PdfContent,
  PlaybackResult,
  TextContent,
  VideoContent,
} from '../api/learning'
import type { LocalizedLabel } from '../api/users'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { fileNameOf, isHttpsUrl, vimeoEmbedUrl, youtubeEmbedUrl } from './learn.format'
import { LiveSessions } from './LiveSessions'
import { MediaPlayer } from './MediaPlayer'
import { PlainText } from './PlainText'
import { YouTubeLesson } from './YouTubeLesson'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLocalized(value: unknown): value is LocalizedLabel {
  return isRecord(value) && typeof value.ar === 'string'
}

function Unavailable() {
  const { t } = useTranslation()
  return <Alert type="info" showIcon title={t('learn.lesson.unavailable')} />
}

export interface LessonContentProps {
  item: LearningItem
  onPlayback: (result: PlaybackResult) => void
  /** False in the author's preview: a medium plays, nothing is saved (D-R144). */
  trackPlayback?: boolean
  /** Completes a lesson on the server (API-234): a YouTube video calls it once the learner has watched the academy's share (J-F64). Absent in the preview. */
  onComplete?: (itemId: string) => Promise<void>
}

export function LessonContent({ item, onPlayback, trackPlayback = true, onComplete }: LessonContentProps) {
  const tracked = trackPlayback && item.completionMode === 'playback'
  const { language } = useLocalized()
  const content: unknown = item.content
  const title = localizedLabel(item.title, language)

  if (item.kind === 'live') {
    const note = isRecord(content) && isLocalized(content.note) ? (content as unknown as LiveContent).note : null
    return <LiveSessions sessions={item.sessions} note={note} />
  }
  if (!isRecord(content)) return <Unavailable />

  switch (item.kind) {
    case 'text': {
      const body = (content as unknown as TextContent).body
      if (!isLocalized(body)) return <Unavailable />
      const text = localizedLabel(body, language)
      return text.trim() ? <PlainText text={text} className="learn-text--lesson" /> : <Unavailable />
    }
    case 'video':
      return (
        <VideoView
          item={item}
          content={content as unknown as VideoContent}
          title={title}
          tracked={tracked}
          onPlayback={onPlayback}
          onComplete={trackPlayback ? onComplete : undefined}
        />
      )
    case 'audio': {
      const audio = content as unknown as AudioContent
      if (!isHttpsUrl(audio.url)) return <Unavailable />
      return (
        <MediaPlayer
          kind="audio"
          itemId={item.id}
          src={audio.url}
          title={title}
          tracked={tracked}
          startPosition={item.progress.positionSeconds}
          onSaved={onPlayback}
        />
      )
    }
    case 'pdf':
      return <PdfView content={content as unknown as PdfContent} />
    case 'image':
      return <ImageView content={content as unknown as ImageContent} title={title} />
    case 'file':
      return <FileView content={content as unknown as FileContent} />
    default:
      return <Unavailable />
  }
}

function VideoView({
  item,
  content,
  title,
  tracked,
  onPlayback,
  onComplete,
}: {
  item: LearningItem
  content: VideoContent
  title: string
  tracked: boolean
  onPlayback: (result: PlaybackResult) => void
  onComplete?: (itemId: string) => Promise<void>
}) {
  const { t } = useTranslation()
  if (content.provider === 'file') {
    if (!isHttpsUrl(content.url)) return <Unavailable />
    return (
      <MediaPlayer
        kind="video"
        itemId={item.id}
        src={content.url}
        title={title}
        captions={Array.isArray(content.captions) ? content.captions : []}
        tracked={tracked}
        startPosition={item.progress.positionSeconds}
        onSaved={onPlayback}
      />
    )
  }
  const videoId = typeof content.videoId === 'string' ? content.videoId : ''
  if ((content.provider !== 'youtube' && content.provider !== 'vimeo') || !videoId) return <Unavailable />
  if (content.provider === 'youtube' && onComplete && item.completionMode === 'manual') {
    return <YouTubeLesson item={item} videoId={videoId} watchUrl={content.url} title={title} onComplete={onComplete} />
  }
  const src = content.provider === 'youtube' ? youtubeEmbedUrl(videoId) : vimeoEmbedUrl(videoId)
  return (
    <div className="learn-media">
      <div className="learn-embed">
        <iframe
          src={src}
          title={title}
          allow="encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      </div>
      {item.completionMode === 'manual' ? <p className="learn-muted learn-media__note">{t('learn.lesson.embedNote')}</p> : null}
    </div>
  )
}

function PdfView({ content }: { content: PdfContent }) {
  const { t } = useTranslation()
  if (!isHttpsUrl(content.url)) return <Unavailable />
  return (
    <div className="learn-attachment">
      <FilePdfOutlined className="learn-attachment__icon" aria-hidden />
      <div className="learn-attachment__body">
        <strong>{t('learn.lesson.documentTitle')}</strong>
        <span className="learn-muted">{t('learn.lesson.documentHint')}</span>
      </div>
      <Button type="primary" icon={<ExportOutlined aria-hidden />} href={content.url} target="_blank" rel="noopener noreferrer">
        {t('learn.lesson.openDocument')}
        <span className="learn-sr-only"> {t('learn.lesson.newTab')}</span>
      </Button>
    </div>
  )
}

function ImageView({ content, title }: { content: ImageContent; title: string }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [failed, setFailed] = useState(false)
  if (!isHttpsUrl(content.url)) return <Unavailable />
  if (failed) return <Alert type="info" showIcon title={t('learn.lesson.imageError')} />
  const alt = isLocalized(content.alt) ? localizedLabel(content.alt, language) : title
  return (
    <figure className="learn-figure">
      <img className="learn-image" src={content.url} alt={alt} referrerPolicy="no-referrer" decoding="async" onError={() => setFailed(true)} />
    </figure>
  )
}

function FileView({ content }: { content: FileContent }) {
  const { t } = useTranslation()
  if (!isHttpsUrl(content.url)) return <Unavailable />
  const name = fileNameOf(content.url, typeof content.fileName === 'string' ? content.fileName : null) ?? t('learn.lesson.fileFallbackName')
  return (
    <div className="learn-attachment">
      <PaperClipOutlined className="learn-attachment__icon" aria-hidden />
      <div className="learn-attachment__body">
        <strong>{t('learn.lesson.fileTitle')}</strong>
        <bdi dir="auto" className="learn-attachment__name">
          {name}
        </bdi>
      </div>
      <Button icon={<DownloadOutlined aria-hidden />} href={content.url} download={name} target="_blank" rel="noopener noreferrer">
        {t('learn.lesson.download')}
        <span className="learn-sr-only"> {name}</span>
      </Button>
    </div>
  )
}
