// The content form of one lesson ↔ API-228 body (MOD-20, D-R131), as pure rules
// unit-tested in curriculum.content.test.ts. Mirrors of
// backend/src/learning/learning.content.ts: https URLs only (an http one would
// be blocked as mixed content), plain text never HTML, a YouTube or Vimeo link
// must name a video, a `file` video and an audio lesson need their length (the
// server measures playback against it — D-R134). The form keeps the fields of
// every kind; the body carries only the fields of the chosen one. A Turkish
// text the form does not show is kept when the kind stays the same.
// PORTAL-04-MINUTES (provisional id — the owner's request): the length of a video or an audio lesson is typed in
// minutes (two decimals at most — 12.5 = 12 min 30 s); the body still carries whole seconds (`durationSeconds`,
// the server's unit), rounded once from the minutes. A stored length reads back as minutes and, untouched, is sent
// as the same seconds (`minutesOf()`/`secondsOf()` round-trip exactly to the second).
import { MEDIA_SECONDS_MAX } from '../api/curriculum'
import type { CurriculumItem, LessonContentInput, LessonContentInputValue, VideoProvider } from '../api/curriculum'
import type { Caption, LearningItemKind, LessonContent } from '../api/learning'
import { localizedOf } from '../courses/courses.form'

export interface CaptionFormValue {
  language?: Caption['language']
  url?: string
  label?: string
}

export interface ResourceFormValue {
  titleAr?: string
  titleEn?: string
  url?: string
}

/** One form for every kind; only the chosen kind's fields reach the body. */
export interface ContentFormValues {
  kind: LearningItemKind
  bodyAr?: string
  bodyEn?: string
  provider?: VideoProvider
  url?: string
  /** The length in minutes (two decimals at most); the body carries it as whole seconds. */
  durationMinutes?: number | null
  captions?: CaptionFormValue[]
  altAr?: string
  altEn?: string
  fileName?: string
  noteAr?: string
  noteEn?: string
  resources?: ResourceFormValue[]
}

const HTTPS_URL = /^https:\/\/[^\s]+$/

/** An absolute https URL without white space (after trimming), as the server's `httpsUrl`. */
export function isHttpsUrl(value: string | undefined | null): boolean {
  return HTTPS_URL.test((value ?? '').trim())
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const VIMEO_ID = /^\d{1,12}$/

function parsedHttps(url: string): URL | null {
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}

/** Mirror of youtubeIdOf(): the video id of a watch, short, embed, live or youtu.be URL; null otherwise. */
export function youtubeIdOf(url: string): string | null {
  const parsed = parsedHttps(url)
  if (!parsed) return null
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = parsed.pathname.split('/')[1] ?? null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts[0] === 'watch') id = parsed.searchParams.get('v')
    else if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') id = parts[1] ?? null
  }
  return id !== null && YOUTUBE_ID.test(id) ? id : null
}

/** Mirror of vimeoIdOf(): the video id of a vimeo.com or player.vimeo.com URL; null otherwise. */
export function vimeoIdOf(url: string): string | null {
  const parsed = parsedHttps(url)
  if (!parsed) return null
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const parts = parsed.pathname.split('/').filter(Boolean)
  let id: string | null = null
  if (host === 'vimeo.com') id = parts.find((part) => VIMEO_ID.test(part)) ?? null
  else if (host === 'player.vimeo.com' && parts[0] === 'video') id = parts[1] ?? null
  return id !== null && VIMEO_ID.test(id) ? id : null
}

/** Whether the kind (and, for a video, its provider) is referenced by a URL. */
export function kindNeedsUrl(kind: LearningItemKind): boolean {
  return kind !== 'text' && kind !== 'live'
}

/** A `file` video and audio need their length: the server measures playback against it (D-R134). */
export function needsDuration(kind: LearningItemKind, provider: VideoProvider | undefined): boolean {
  return kind === 'audio' || (kind === 'video' && (provider ?? 'file') === 'file')
}

/** The longest length the form takes, in minutes (MEDIA_SECONDS_MAX of the server, 24 hours). */
export const MEDIA_MINUTES_MAX = MEDIA_SECONDS_MAX / 60

/** Stored seconds as the form's minutes, to two decimals. */
export function minutesOf(seconds: number): number {
  return Math.round((seconds / 60) * 100) / 100
}

/** The form's minutes as the body's whole seconds. */
export function secondsOf(minutes: number): number {
  return Math.round(minutes * 60)
}

/** A typed length the server takes: more than 0, at most two decimals, 1 s to MEDIA_SECONDS_MAX once in seconds. */
export function isMediaMinutes(minutes: number): boolean {
  if (!Number.isFinite(minutes) || minutes <= 0) return false
  if (Math.abs(minutes * 100 - Math.round(minutes * 100)) > 1e-6) return false
  const seconds = secondsOf(minutes)
  return seconds >= 1 && seconds <= MEDIA_SECONDS_MAX
}

/** The form as the lesson's stored content and resources fill it; every other field empty. */
export function contentFormValuesOf(item: CurriculumItem): ContentFormValues {
  const values: ContentFormValues = {
    kind: item.kind,
    bodyAr: '',
    bodyEn: '',
    provider: 'file',
    url: '',
    durationMinutes: null,
    captions: [],
    altAr: '',
    altEn: '',
    fileName: '',
    noteAr: '',
    noteEn: '',
    resources: item.resources.map((resource) => ({ titleAr: resource.title.ar, titleEn: resource.title.en ?? '', url: resource.url })),
  }
  const content = item.content as (LessonContent & Record<string, unknown>) | null
  if (!content) return values
  switch (item.kind) {
    case 'text': {
      const { body } = content as { body: { ar: string; en?: string } }
      return { ...values, bodyAr: body.ar, bodyEn: body.en ?? '' }
    }
    case 'video': {
      const video = content as { provider: VideoProvider; url: string; durationSeconds: number | null; captions?: Caption[] }
      return {
        ...values,
        provider: video.provider,
        url: video.url,
        durationMinutes: video.durationSeconds === null ? null : minutesOf(video.durationSeconds),
        captions: (video.captions ?? []).map((caption) => ({ language: caption.language, url: caption.url, label: caption.label ?? '' })),
      }
    }
    case 'audio': {
      const audio = content as { url: string; durationSeconds: number }
      return { ...values, url: audio.url, durationMinutes: minutesOf(audio.durationSeconds) }
    }
    case 'pdf':
      return { ...values, url: (content as { url: string }).url }
    case 'image': {
      const image = content as { url: string; alt: { ar: string; en?: string } | null }
      return { ...values, url: image.url, altAr: image.alt?.ar ?? '', altEn: image.alt?.en ?? '' }
    }
    case 'file': {
      const file = content as { url: string; fileName: string | null }
      return { ...values, url: file.url, fileName: file.fileName ?? '' }
    }
    case 'live': {
      const live = content as { note: { ar: string; en?: string } | null }
      return { ...values, noteAr: live.note?.ar ?? '', noteEn: live.note?.en ?? '' }
    }
  }
}

const trimmed = (value: string | undefined) => (value ?? '').trim()

/** The Turkish text of a stored localized field of the same kind, kept by the save. */
function storedTr(item: CurriculumItem, kind: LearningItemKind, field: 'body' | 'alt' | 'note'): string | undefined {
  if (item.kind !== kind || !item.content) return undefined
  const value = (item.content as unknown as Record<string, { tr?: string } | null | undefined>)[field]
  return value?.tr
}

function contentOf(values: ContentFormValues, item: CurriculumItem): LessonContentInputValue | null {
  const url = trimmed(values.url)
  const minutes = values.durationMinutes
  const duration = typeof minutes === 'number' ? secondsOf(minutes) : null
  switch (values.kind) {
    case 'text': {
      const body = localizedOf(values.bodyAr, values.bodyEn, storedTr(item, 'text', 'body'))
      return body ? { body } : null
    }
    case 'video': {
      if (!url) return null
      const provider = values.provider ?? 'file'
      if (provider !== 'file') return { provider, url, durationSeconds: duration }
      const captions = (values.captions ?? []).map((caption) => {
        const label = trimmed(caption.label)
        return label ? { language: caption.language ?? 'ar', url: trimmed(caption.url), label } : { language: caption.language ?? 'ar', url: trimmed(caption.url) }
      })
      return { provider, url, durationSeconds: duration, captions }
    }
    case 'audio':
      // The form refuses an empty length before any request (and the server refuses 0).
      return url ? { url, durationSeconds: duration ?? 0 } : null
    case 'pdf':
      return url ? { url } : null
    case 'image':
      return url ? { url, alt: localizedOf(values.altAr, values.altEn, storedTr(item, 'image', 'alt')) } : null
    case 'file':
      return url ? { url, fileName: trimmed(values.fileName) || null } : null
    case 'live':
      return { note: localizedOf(values.noteAr, values.noteEn, storedTr(item, 'live', 'note')) }
  }
}

/** API-228 body: the chosen kind, its content (null when its main field is empty) and every resource. */
export function buildLessonContentInput(values: ContentFormValues, item: CurriculumItem): LessonContentInput {
  return {
    kind: values.kind,
    content: contentOf(values, item),
    resources: (values.resources ?? []).map((resource, index) => {
      const url = trimmed(resource.url)
      const previous = item.resources[index]
      const keepTr = previous && previous.url === url ? previous.title.tr : undefined
      return { title: localizedOf(resource.titleAr, resource.titleEn, keepTr) ?? { ar: trimmed(resource.titleAr) }, url }
    }),
  }
}

/** Whether the form holds a change: its body differs from the body of the untouched form. */
export function contentFormHasChanges(item: CurriculumItem, values: ContentFormValues): boolean {
  return JSON.stringify(buildLessonContentInput(values, item)) !== JSON.stringify(buildLessonContentInput(contentFormValuesOf(item), item))
}
