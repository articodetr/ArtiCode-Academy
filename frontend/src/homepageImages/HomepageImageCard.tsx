// One place of the public home page in the homepage images tab: its name, its state
// (default / custom, with the server's date), its picture in the frame of the place on
// /home, and its actions — choose a picture (nothing is sent: the manager checks it and
// keeps it as a preview), save the chosen one, cancel it, preview it larger, and restore
// the default behind a confirmation. The card shows; the manager decides and writes.
import { EyeOutlined, PictureOutlined, RollbackOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Modal, Popconfirm, Tag, Tooltip, Typography, Upload } from 'antd'
import type { UploadProps } from 'antd'
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { HomepageImage, HomepageImageContentType } from '../api/homepageImages'
import { useLocalized } from '../i18n/useLocalized'
import type { HomeImageSlot } from '../publicHome/homeImageSlots'
import { formatDateTime } from '../users/users.format'
import { failureMessage } from './homepageImages.errors'
import type { HomepageImagesFailure } from './homepageImages.errors'
import { dimensionsText, PICTURE_ACCEPT, PICTURE_MAX_PIXELS, PICTURE_MAX_SIDE, PICTURE_MIN_SIDE, pictureTypeLabel } from './homepageImages.rules'
import type { PictureRefusal, PictureWarning } from './homepageImages.rules'

/** A picture chosen from the computer and checked, not sent yet. */
export interface PendingPicture {
  file: Blob
  contentType: HomepageImageContentType
  width: number
  height: number
  bytes: number
  /** The `data:` URL the preview shows (never `blob:` — the deployed CSP refuses it). */
  previewUrl: string
  warnings: PictureWarning[]
}

/** What the card tells under its picture: a file refused before any request, or a write the server refused. */
export type CardNote = { kind: 'refused'; refusal: PictureRefusal } | { kind: 'saveFailed' | 'resetFailed'; failure: HomepageImagesFailure }

export interface HomepageImageCardProps {
  slot: HomeImageSlot
  /** The server's state of the place (a default when the server named none). */
  item: HomepageImage | undefined
  /** The published picture's address for an <img>, or null for the default. */
  publishedSrc: string | null
  pending: PendingPicture | null
  note: CardNote | null
  /** This card's write in flight. */
  busy: 'save' | 'reset' | null
  /** Another card's write is in flight: one write at a time, so every answer shown is the latest list. */
  locked: boolean
  /** The server's limit of a picture's file, shown in the recommendation. */
  maxBytes: number
  formatBytes: (bytes: number) => string
  onChoose: (file: File) => void
  onSave: () => void
  onCancel: () => void
  onReset: () => void
  onDismissNote: () => void
}

/** The frame of the place: its shape, and a size the stage can hold (homepageImages.css). */
function frameStyle(slot: HomeImageSlot): CSSProperties {
  return { aspectRatio: `${slot.width} / ${slot.height}`, width: `min(100%, calc(var(--frame-height) * ${slot.width} / ${slot.height}))` }
}

interface FramedPictureProps {
  slot: HomeImageSlot
  src: string
  alt: string
  marker: string | null
  /** What shows when the picture cannot be displayed: the published one, or the chosen one before saving. */
  unavailable: string
  large?: boolean
}

/** The picture as visitors see it in its place: `contain` (the hero, over the pale disc) or `cover`. */
function FramedPicture({ slot, src, alt, marker, unavailable, large = false }: FramedPictureProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = failedSrc === src
  return (
    <div className={`homepage-images__stage${large ? ' homepage-images__stage--large' : ''}`}>
      <div className={`homepage-images__frame${slot.transparent ? ' homepage-images__frame--transparent' : ''}`} style={frameStyle(slot)} data-testid="homepage-image-frame" data-fit={slot.fit}>
        {marker ? (
          <Tag color="gold" className="homepage-images__marker">
            {marker}
          </Tag>
        ) : null}
        {failed ? (
          <div className="homepage-images__unavailable" role="img" aria-label={alt}>
            <PictureOutlined aria-hidden style={{ fontSize: 24 }} />
            {unavailable}
          </div>
        ) : (
          <img className="homepage-images__image" src={src} alt={alt} style={{ objectFit: slot.fit }} onError={() => setFailedSrc(src)} />
        )}
      </div>
    </div>
  )
}

/** One note, one Alert: a new note never inherits the closed state of the previous one. */
function noteKey(note: CardNote): string {
  return note.kind === 'refused' ? `refused:${note.refusal.reason}` : `${note.kind}:${note.failure.key}`
}

function noteMessage(t: ReturnType<typeof useTranslation>['t'], note: CardNote, formatBytes: (bytes: number) => string): { title: string; description: string } {
  if (note.kind !== 'refused') {
    return { title: t(note.kind === 'saveFailed' ? 'homepageImages.saveFailed' : 'homepageImages.resetFailed'), description: failureMessage(t, note.failure) }
  }
  const { refusal } = note
  const description =
    refusal.reason === 'tooLarge'
      ? t('homepageImages.refused.tooLarge', { size: formatBytes(refusal.bytes), max: formatBytes(refusal.maxBytes) })
      : refusal.reason === 'dimensions'
        ? t('homepageImages.refused.dimensions', {
            size: dimensionsText(refusal.width, refusal.height),
            min: PICTURE_MIN_SIDE,
            max: PICTURE_MAX_SIDE,
            pixels: PICTURE_MAX_PIXELS / 1_000_000,
          })
        : t(`homepageImages.refused.${refusal.reason}`)
  return { title: t('homepageImages.refused.title'), description }
}

export function HomepageImageCard(props: HomepageImageCardProps) {
  const { slot, item, publishedSrc, pending, note, busy, locked, maxBytes, formatBytes, onChoose, onSave, onCancel, onReset, onDismissNote } = props
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [previewOpen, setPreviewOpen] = useState(false)

  const section = t(`homepageImages.sections.${slot.key}`)
  const custom = item?.custom === true
  const published = custom && publishedSrc ? publishedSrc : slot.defaultSrc
  const shownSrc = pending ? pending.previewUrl : published
  const shownAlt = pending ? t('homepageImages.pendingAlt', { section }) : t('homepageImages.frameAlt', { section })
  const marker = pending ? t('homepageImages.pending.marker') : null
  const unavailable = pending ? t('homepageImages.pendingUnavailable') : t('homepageImages.unavailable')
  const writing = busy !== null

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    onChoose(file)
    // The card handles the file itself: nothing is uploaded by antd, nothing goes to a list.
    return Upload.LIST_IGNORE
  }

  const resetBlocker = !custom ? t('homepageImages.actions.resetIsDefault') : pending ? t('homepageImages.actions.resetWhilePending') : null
  const resetLabel = t('homepageImages.actions.reset')
  const resetButton = resetBlocker ? (
    <Tooltip title={resetBlocker}>
      <span>
        <Button icon={<RollbackOutlined />} disabled>
          {resetLabel}
        </Button>
      </span>
    </Tooltip>
  ) : (
    <Popconfirm
      title={t('homepageImages.actions.resetConfirm', { section })}
      description={t('homepageImages.actions.resetConfirmHint')}
      okText={t('homepageImages.actions.resetOk')}
      cancelText={t('common.cancel')}
      onConfirm={onReset}
      disabled={locked}
    >
      <Button icon={<RollbackOutlined />} loading={busy === 'reset'} disabled={locked && busy !== 'reset'}>
        {resetLabel}
      </Button>
    </Popconfirm>
  )

  const shown = note ? noteMessage(t, note, formatBytes) : null

  return (
    <section className="homepage-images__slot" aria-label={section} data-testid={`homepage-image-${slot.key}`}>
      <Card className="homepage-images__card" size="small">
        <div className="homepage-images__card-head">
          <h3 className="homepage-images__card-title">{section}</h3>
          {custom ? <Tag color="blue">{t('homepageImages.status.custom')}</Tag> : <Tag>{t('homepageImages.status.default')}</Tag>}
        </div>
        <Typography.Text type="secondary" className="homepage-images__meta">
          {custom && item?.updatedAt ? t('homepageImages.status.updatedAt', { date: formatDateTime(item.updatedAt, language) }) : t('homepageImages.status.defaultHint')}
        </Typography.Text>

        <FramedPicture slot={slot} src={shownSrc} alt={shownAlt} marker={marker} unavailable={unavailable} />

        {pending ? (
          <div className="homepage-images__meta" data-testid="homepage-image-pending">
            <div>
              {t('homepageImages.pending.details', {
                type: pictureTypeLabel(pending.contentType),
                size: dimensionsText(pending.width, pending.height),
                bytes: formatBytes(pending.bytes),
              })}
            </div>
            <div>{t('homepageImages.pending.hint')}</div>
          </div>
        ) : null}

        {shown && note ? <Alert key={noteKey(note)} type="error" showIcon closable={{ onClose: onDismissNote }} title={shown.title} description={shown.description} /> : null}

        {pending && pending.warnings.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            title={t('homepageImages.warnings.title')}
            description={
              <ul className="homepage-images__warnings">
                {pending.warnings.map((warning) => (
                  <li key={warning}>{t(`homepageImages.warnings.${warning}`, { size: dimensionsText(slot.width, slot.height) })}</li>
                ))}
              </ul>
            }
          />
        ) : null}

        <div className="homepage-images__meta" data-testid="homepage-image-recommended">
          <div>{t(slot.transparent ? 'homepageImages.recommended.transparent' : 'homepageImages.recommended.photo', { size: dimensionsText(slot.width, slot.height) })}</div>
          <div>{t('homepageImages.recommended.maxSize', { size: formatBytes(maxBytes) })}</div>
        </div>

        <div className="homepage-images__actions">
          {pending ? (
            <>
              <Button type="primary" icon={<SaveOutlined />} loading={busy === 'save'} disabled={locked && busy !== 'save'} onClick={onSave}>
                {t('homepageImages.actions.save')}
              </Button>
              <Button onClick={onCancel} disabled={writing}>
                {t('homepageImages.actions.cancel')}
              </Button>
            </>
          ) : null}
          <Upload accept={{ format: PICTURE_ACCEPT, filter: 'native' }} showUploadList={false} multiple={false} beforeUpload={beforeUpload} disabled={writing}>
            <Button icon={<UploadOutlined />} disabled={writing}>
              {t('homepageImages.actions.change')}
            </Button>
          </Upload>
          <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>
            {t('homepageImages.actions.preview')}
          </Button>
          {resetButton}
        </div>
      </Card>

      <Modal
        open={previewOpen}
        title={t('homepageImages.preview.title', { section })}
        onCancel={() => setPreviewOpen(false)}
        footer={<Button onClick={() => setPreviewOpen(false)}>{t('homepageImages.preview.close')}</Button>}
        width={920}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          {pending ? t('homepageImages.preview.pending') : t('homepageImages.preview.published')} {t('homepageImages.preview.frame', { size: dimensionsText(slot.width, slot.height) })}
        </Typography.Paragraph>
        <FramedPicture slot={slot} src={shownSrc} alt={shownAlt} marker={marker} unavailable={unavailable} large />
      </Modal>
    </section>
  )
}
