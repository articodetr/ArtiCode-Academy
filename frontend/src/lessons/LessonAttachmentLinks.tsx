// A lesson's video and attachments as links (J-F77) — the lesson drawer, «my
// lessons» and the class lessons of a learner show them the same way: the
// video («مشاهدة الفيديو») and each attachment by its title, a book with a
// book icon and a link with a link icon, each opening in a new tab. The links
// are the server's (https only); nothing is shown for a cancelled lesson by
// the callers.
import { LinkOutlined, PlayCircleOutlined, ReadOutlined } from '@ant-design/icons'
import { Space, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import type { LessonAttachment } from '../api/lessons'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'

interface LessonAttachmentLinksProps {
  /** The video link, or null for none. */
  recordingUrl?: string | null
  attachments: readonly LessonAttachment[]
}

/** Renders nothing when the lesson has neither a video nor an attachment. */
export function LessonAttachmentLinks({ recordingUrl = null, attachments }: LessonAttachmentLinksProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  if (!recordingUrl && attachments.length === 0) return null
  return (
    <Space wrap size={[12, 4]} data-testid="lesson-attachment-links">
      {recordingUrl ? (
        <Typography.Link href={recordingUrl} target="_blank" rel="noopener noreferrer">
          <PlayCircleOutlined /> {t('lessons.attachments.watchVideo')}
        </Typography.Link>
      ) : null}
      {attachments.map((attachment, index) => (
        <Typography.Link key={`${index}:${attachment.url}`} href={attachment.url} target="_blank" rel="noopener noreferrer">
          {attachment.kind === 'book' ? <ReadOutlined aria-label={t('lessons.attachments.kinds.book')} /> : <LinkOutlined aria-label={t('lessons.attachments.kinds.link')} />}{' '}
          <bdi>{localizedLabel(attachment.title, language)}</bdi>
        </Typography.Link>
      ))}
    </Space>
  )
}
