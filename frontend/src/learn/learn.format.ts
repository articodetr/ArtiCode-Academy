// Pure presentation helpers of the learning workspace (MOD-20, roadmap §4q):
// the names of the levels (D-R130 — «المستوى الأول — …»), lesson lengths, the
// paragraphs of a text lesson, the privacy-enhanced embed addresses of an
// external video (D-R131). No React, no i18next instance — callers pass `t`.
// Unit-tested in learn.format.test.ts.
import type { LearningItemKind } from '../api/learning'
import type { LocalizedLabel } from '../api/users'
import type { Language } from '../i18n/language'
import { levelOrdinalWord } from '../common/levelOrdinal'
import { localizedLabel } from '../users/users.format'
import type { Translate } from '../users/users.format'

/** The ordinal of a level in the UI language — the one rule of common/levelOrdinal.ts (1..99 as Arabic words). */
export function levelOrdinal(number: number, language: Language): string {
  return levelOrdinalWord(number, language)
}

/** «المستوى الأول», or «المستوى الأول — أساسيات» when the level has a title (D-R130). */
export function levelName(section: { number: number; title: LocalizedLabel | null }, t: Translate, language: Language): string {
  const ordinal = levelOrdinal(section.number, language)
  const title = section.title ? localizedLabel(section.title, language).trim() : ''
  return title ? t('learn.level.named', { ordinal, title }) : t('learn.level.name', { ordinal })
}

/** A media length as a clock: `4:05`, `12:00`, or `1:02:05` from an hour on. Null for a missing or negative value. */
export function formatClockDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const two = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${minutes}:${two(rest)}`
}

export interface DurationLabel {
  text: string
  /** True for a clock (`mm:ss`) — render it in `<bdi dir="ltr">`. */
  clock: boolean
}

/**
 * How long a lesson takes, as the sidebar and the lesson header show it: a
 * measured medium (video, audio) by its own length as a clock; anything else
 * by the author's estimate in minutes («45 د»); null when neither is known.
 * `durationSeconds` is the server's displayDurationSecondsOf() — the medium's
 * length when known, else the estimate.
 */
export function itemDurationLabel(
  item: { kind: LearningItemKind; durationSeconds: number | null; estimatedMinutes: number | null },
  t: Translate,
): DurationLabel | null {
  if ((item.kind === 'video' || item.kind === 'audio') && item.durationSeconds !== null) {
    const text = formatClockDuration(item.durationSeconds)
    if (text) return { text, clock: true }
  }
  const minutes = item.estimatedMinutes ?? (item.durationSeconds !== null ? Math.max(1, Math.round(item.durationSeconds / 60)) : null)
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null
  return { text: t('learn.duration.minutes', { minutes }), clock: false }
}

/**
 * The paragraphs of a plain-text lesson (D-R131): split on blank lines; the
 * single line breaks inside a paragraph stay (the page shows them with
 * `white-space: pre-line`). Never HTML — React renders every paragraph as text.
 */
export function paragraphsOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n(?:[ \t]*\n)+/)
    .map((paragraph) => paragraph.replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, ''))
    .filter((paragraph) => paragraph.trim() !== '')
}

/** YouTube's privacy-enhanced player (D-R131): no cookie before the learner plays. */
export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`
}

/** Vimeo's player with Do Not Track (D-R131). */
export function vimeoEmbedUrl(videoId: string): string {
  return `https://player.vimeo.com/video/${encodeURIComponent(videoId)}?dnt=1`
}

/** The name a downloadable file shows: the author's, else the last segment of its address, else null. */
export function fileNameOf(url: string, fileName: string | null): string | null {
  const named = fileName?.trim()
  if (named) return named
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop()
    if (!segment) return null
    const decoded = decodeURIComponent(segment)
    return decoded.trim() || null
  } catch {
    return null
  }
}

/** True for an absolute https address — the only kind the server stores (D-R131); anything else is never rendered. */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
