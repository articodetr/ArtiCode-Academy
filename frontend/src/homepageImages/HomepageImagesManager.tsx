// Settings → «صور الصفحة الرئيسية»: the four pictures of the public home page /home,
// each replaced on its own with no code change and no rebuild. One card per place, in
// the order of HOME_IMAGE_KEYS. Choosing a picture sends nothing: it is checked here
// first (homepageImages.rules.ts — the type from its bytes, its size, its dimensions;
// a refused file never reaches the server), then kept as a preview in its frame with
// warnings that never block saving. «حفظ» sends ONE PUT with the file itself and the
// type read from its bytes; the published picture changes only when the server answers
// 200, and the card then shows the list the server returned. A refusal keeps the chosen
// picture so the admin can retry or cancel. «استعادة الافتراضية» sends a DELETE behind a
// confirmation. One write at a time across the tab, so the list on screen is always the
// latest answer. A chosen picture that is not saved is guarded: leaving the tab (another
// settings tab, the menu, the browser's back) asks first, and so does a reload or a tab
// close (useUnsavedChangesGuard + NavigationBlocker). While a save or a restore is being
// written, leaving is held without that question — the write would land anyway — and a
// notice says to wait. The preview of a chosen picture is a `data:` URL (the deployed CSP
// refuses `blob:` pictures — homepageImages.load.ts). The tab is management-only: the
// route, the nav entry and SettingsPage gate it on `academy.settings.manage`.
import { ExportOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Skeleton, Tooltip, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiUrl } from '../api/client'
import { HOMEPAGE_IMAGE_MAX_BYTES, resetHomepageImage, uploadHomepageImage } from '../api/homepageImages'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { preventUnload } from '../common/unsavedChanges'
import type { BlockedNavigation } from '../common/unsavedChanges'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { useLocalized } from '../i18n/useLocalized'
import { HOME_IMAGE_KEYS, HOME_IMAGE_SLOTS } from '../publicHome/homeImageSlots'
import type { HomeImageKey } from '../publicHome/homeImageSlots'
import { HomepageImageCard } from './HomepageImageCard'
import type { CardNote, PendingPicture } from './HomepageImageCard'
import { describeHomepageImagesFailure, failureMessage } from './homepageImages.errors'
import { checkOpaqueCorners, readPictureBytes, readPictureDataUrl } from './homepageImages.load'
import { fileSizeParts, inspectPicture, pictureWarnings, publishedSrc, sizeRefusal, withOpaqueCorners } from './homepageImages.rules'
import type { PictureRefusal } from './homepageImages.rules'
import { useHomepageImages } from './useHomepageImages'
import './homepageImages.css'

type ByKey<T> = Partial<Record<HomeImageKey, T>>

function without<T>(map: ByKey<T>, key: HomeImageKey): ByKey<T> {
  if (!(key in map)) return map
  const next = { ...map }
  delete next[key]
  return next
}

export function HomepageImagesManager() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message, modal } = App.useApp()
  const { images, loading, error, reload, replace } = useHomepageImages()
  const [pending, setPending] = useState<ByKey<PendingPicture>>({})
  const [notes, setNotes] = useState<ByKey<CardNote>>({})
  const [busy, setBusy] = useState<{ key: HomeImageKey; action: 'save' | 'reset' } | null>(null)

  /** The latest choice per place: a file still being read when another is chosen is dropped. */
  const choices = useRef<ByKey<number>>({})
  /** The corner checks of the hero's chosen picture, stopped when the choice goes. */
  const cornerChecks = useRef(new Map<HomeImageKey, AbortController>())

  const maxBytes = images?.maxBytes ?? HOMEPAGE_IMAGE_MAX_BYTES

  const numberFormat = useMemo(() => new Intl.NumberFormat(language === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { maximumFractionDigits: 1 }), [language])
  const formatBytes = useCallback(
    (bytes: number) => {
      const { unit, value } = fileSizeParts(bytes)
      return t(`homepageImages.size.${unit}`, { value: numberFormat.format(value) })
    },
    [numberFormat, t],
  )

  // The tab left the page: every corner check goes with it, and a file still being read is dropped.
  useEffect(() => {
    const checks = cornerChecks.current
    const latest = choices.current
    return () => {
      for (const key of HOME_IMAGE_KEYS) latest[key] = (latest[key] ?? 0) + 1
      for (const check of checks.values()) check.abort()
      checks.clear()
    }
  }, [])

  const stopCornerCheck = (key: HomeImageKey) => {
    cornerChecks.current.get(key)?.abort()
    cornerChecks.current.delete(key)
  }

  const refuse = (key: HomeImageKey, refusal: PictureRefusal) => setNotes((current) => ({ ...current, [key]: { kind: 'refused', refusal } }))

  const choose = async (key: HomeImageKey, file: File) => {
    const choice = (choices.current[key] ?? 0) + 1
    choices.current[key] = choice
    const isLatest = () => choices.current[key] === choice
    setNotes((current) => without(current, key))

    const tooBig = sizeRefusal(file.size, maxBytes)
    if (tooBig) {
      refuse(key, tooBig)
      return
    }
    let bytes: Uint8Array<ArrayBuffer>
    try {
      bytes = await readPictureBytes(file)
    } catch {
      if (isLatest()) refuse(key, { reason: 'unreadable' })
      return
    }
    if (!isLatest()) return
    const inspected = inspectPicture(bytes)
    if ('refusal' in inspected) {
      // A refused file leaves an earlier chosen picture of the place as it was.
      refuse(key, inspected.refusal)
      return
    }

    const { info } = inspected
    let previewUrl: string
    try {
      previewUrl = await readPictureDataUrl(bytes, info.contentType)
    } catch {
      if (isLatest()) refuse(key, { reason: 'unreadable' })
      return
    }
    if (!isLatest()) return
    const slot = HOME_IMAGE_SLOTS[key]
    stopCornerCheck(key)
    setPending((current) => ({
      ...current,
      [key]: { file, contentType: info.contentType, width: info.width, height: info.height, bytes: file.size, previewUrl, warnings: pictureWarnings(slot, info) },
    }))

    // The hero's cut-out person: a picture that can hold transparency but whose four corners are opaque warns too.
    if (slot.transparent && info.alpha) {
      const controller = new AbortController()
      cornerChecks.current.set(key, controller)
      const opaque = await checkOpaqueCorners(previewUrl, controller.signal)
      if (opaque !== true || controller.signal.aborted) return
      setPending((current) => {
        const chosen = current[key]
        return chosen && chosen.previewUrl === previewUrl ? { ...current, [key]: { ...chosen, warnings: withOpaqueCorners(chosen.warnings) } } : current
      })
    }
  }

  const cancel = (key: HomeImageKey) => {
    choices.current[key] = (choices.current[key] ?? 0) + 1
    stopCornerCheck(key)
    setPending((current) => without(current, key))
    setNotes((current) => without(current, key))
  }

  const discardAll = useCallback(() => {
    for (const key of HOME_IMAGE_KEYS) choices.current[key] = (choices.current[key] ?? 0) + 1
    for (const check of cornerChecks.current.values()) check.abort()
    cornerChecks.current.clear()
    setPending({})
    setNotes({})
  }, [])

  const unsaved = Object.keys(pending).length > 0
  const { holdNavigation } = useUnsavedChangesGuard(unsaved, discardAll, 'homepageImages.unsaved')

  // A save or a restore in flight: leaving cannot discard it (the server writes it anyway), so a navigation is held with a notice
  // to wait instead of the «discard?» question, and a reload or a tab close gets the browser's own prompt.
  const writing = busy !== null
  const latest = useRef({ writing, modal, t })
  useEffect(() => {
    latest.current = { writing, modal, t }
  })
  const writingNotice = useRef<{ destroy: () => void } | null>(null)
  useEffect(() => {
    if (!writing) return
    const listener = (event: BeforeUnloadEvent) => preventUnload(event)
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }, [writing])
  useEffect(() => () => writingNotice.current?.destroy(), [])
  // Stable, so NavigationBlocker's effect does not hand the same held navigation over twice.
  const onBlocked = useCallback(
    (navigation: BlockedNavigation | null) => {
      const { writing: writingNow, modal: modalNow, t: tNow } = latest.current
      if (navigation && writingNow) {
        navigation.reset()
        if (writingNotice.current) return
        writingNotice.current = modalNow.info({
          title: tNow('homepageImages.writing.title'),
          content: tNow('homepageImages.writing.content'),
          okText: tNow('homepageImages.writing.ok'),
          onOk: () => {
            writingNotice.current = null
          },
          onCancel: () => {
            writingNotice.current = null
          },
        })
        return
      }
      holdNavigation(navigation)
    },
    [holdNavigation],
  )

  const save = async (key: HomeImageKey) => {
    const choice = pending[key]
    if (!choice || busy) return
    setBusy({ key, action: 'save' })
    setNotes((current) => without(current, key))
    try {
      const next = await uploadHomepageImage(key, choice.file, choice.contentType)
      replace(next)
      stopCornerCheck(key)
      setPending((current) => (current[key] === choice ? without(current, key) : current))
      message.success(t('homepageImages.saved', { section: t(`homepageImages.sections.${key}`) }))
    } catch (caught) {
      // The chosen picture stays, so the admin can retry or cancel; the published one is unchanged.
      setNotes((current) => ({ ...current, [key]: { kind: 'saveFailed', failure: describeHomepageImagesFailure(caught, formatBytes, maxBytes) } }))
    } finally {
      setBusy(null)
    }
  }

  const reset = async (key: HomeImageKey) => {
    if (busy) return
    setBusy({ key, action: 'reset' })
    setNotes((current) => without(current, key))
    try {
      const next = await resetHomepageImage(key)
      replace(next)
      message.success(t('homepageImages.restored', { section: t(`homepageImages.sections.${key}`) }))
    } catch (caught) {
      setNotes((current) => ({ ...current, [key]: { kind: 'resetFailed', failure: describeHomepageImagesFailure(caught, formatBytes, maxBytes) } }))
    } finally {
      setBusy(null)
    }
  }

  const loadFailure = error ? describeHomepageImagesFailure(error, formatBytes, maxBytes) : null

  return (
    <Card>
      {/* A chosen picture that is not saved, or a write in flight, holds a navigation (another tab, the menu, the browser's back). */}
      <NavigationBlocker when={unsaved || writing} onBlocked={onBlocked} />
      <div className="homepage-images__intro">
        <div className="homepage-images__intro-text">
          <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>
            {t('homepageImages.title')}
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
            {t('homepageImages.description')}
          </Typography.Paragraph>
          <Typography.Link href="/home" target="_blank" rel="noopener noreferrer">
            <ExportOutlined aria-hidden /> {t('homepageImages.viewHome')}
            <span className="homepage-images__sr-only"> {t('homepageImages.newTab')}</span>
          </Typography.Link>
        </div>
        <Tooltip title={t('homepageImages.refresh')}>
          <Button icon={<ReloadOutlined />} onClick={reload} loading={loading && images !== null} aria-label={t('homepageImages.refresh')} />
        </Tooltip>
      </div>

      {loadFailure ? (
        <Alert
          type="error"
          showIcon
          title={t('homepageImages.loadFailed')}
          description={failureMessage(t, loadFailure)}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={reload} loading={loading}>
              {t('homepageImages.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {images ? (
        <div className="homepage-images__grid">
          {HOME_IMAGE_KEYS.map((key) => {
            const item = images.items.find((entry) => entry.key === key)
            return (
              <HomepageImageCard
                key={key}
                slot={HOME_IMAGE_SLOTS[key]}
                item={item}
                publishedSrc={publishedSrc(item?.url, apiUrl)}
                pending={pending[key] ?? null}
                note={notes[key] ?? null}
                busy={busy?.key === key ? busy.action : null}
                locked={busy !== null}
                maxBytes={maxBytes}
                formatBytes={formatBytes}
                onChoose={(file) => void choose(key, file)}
                onSave={() => void save(key)}
                onCancel={() => cancel(key)}
                onReset={() => void reset(key)}
                onDismissNote={() => setNotes((current) => without(current, key))}
              />
            )
          })}
        </div>
      ) : loading ? (
        <div data-testid="homepage-images-loading">
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      ) : null}
    </Card>
  )
}
