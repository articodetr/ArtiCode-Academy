// The lesson content of MOD-20 «My School» (roadmap §4q, D-R131/D-R134) as
// pure rules, unit-tested in learning.content.spec.ts. A curriculum lesson
// (a `course_syllabus_items` row) has a `kind` and a `content` object whose
// shape follows it, plus a short list of downloadable `resources`.
//
// - Media is referenced by absolute https URL: the academy has no file
//   storage, and a URL the provider serves publicly stays public — the
//   learner workspace never claims otherwise.
// - Text is plain text, never HTML: the frontend renders it as text (React
//   escapes it), so there is nothing to sanitise and no markup to inject.
// - YouTube and Vimeo are stored as their video id and embedded through the
//   providers' privacy-enhanced players; only a `file` video (an HTML5 media
//   URL) and audio can be measured, so only they complete by playback.
//
// `parseLessonContent()` is the write-side check (the 400 of API-228);
// `readLessonContent()` is the lenient read: a stored value that no longer
// fits its kind reads as `null` (no content) instead of failing a request.
import { z } from 'zod';
import type { LearningItemKind } from '../generated/prisma/client.js';

export const LEARNING_ITEM_KINDS = ['text', 'video', 'audio', 'pdf', 'image', 'file', 'live'] as const satisfies readonly LearningItemKind[];

export const VIDEO_PROVIDERS = ['file', 'youtube', 'vimeo'] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

/** Upper bounds (they also bound the request body of API-228: about 164 KB at most — its own JSON limit in LARGE_JSON_ROUTES). */
export const TEXT_BODY_MAX = 8000;
export const SHORT_TEXT_MAX = 300;
export const URL_MAX = 2048;
export const MEDIA_SECONDS_MAX = 86_400;
export const RESOURCES_MAX = 20;
export const CAPTIONS_MAX = 5;

/** An absolute https URL without white space (an http one would be blocked as mixed content on an https page). */
const httpsUrl = z
  .string()
  .trim()
  .max(URL_MAX)
  .regex(/^https:\/\/[^\s]+$/, 'must be an absolute https URL');

function localized(max: number) {
  const optionalLocale = z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value));
  return z
    .object({ ar: z.string().trim().min(1).max(max), en: optionalLocale, tr: optionalLocale })
    .strict()
    .transform((value) => {
      const out: { ar: string; en?: string; tr?: string } = { ar: value.ar };
      if (value.en !== undefined) out.en = value.en;
      if (value.tr !== undefined) out.tr = value.tr;
      return out;
    });
}

const mediaSeconds = z.number().int().min(1).max(MEDIA_SECONDS_MAX);

const captionSchema = z
  .object({
    language: z.enum(['ar', 'en', 'tr']),
    url: httpsUrl,
    label: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;

/** The YouTube video id of a watch, short, embed or youtu.be URL; null when the URL is not one. */
export function youtubeIdOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = parsed.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = parsed.searchParams.get('v');
    else if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') id = parts[1] ?? null;
  }
  return id !== null && YOUTUBE_ID.test(id) ? id : null;
}

/** The Vimeo video id of a vimeo.com or player.vimeo.com URL; null when the URL is not one. */
export function vimeoIdOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const parts = parsed.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (host === 'vimeo.com') id = parts.find((part) => VIMEO_ID.test(part)) ?? null;
  else if (host === 'player.vimeo.com' && parts[0] === 'video') id = parts[1] ?? null;
  return id !== null && VIMEO_ID.test(id) ? id : null;
}

// ---------------------------------------------------------------------------
// The stored shapes (what API-226/231 answer)
// ---------------------------------------------------------------------------

export interface LocalizedValue {
  ar: string;
  en?: string;
  tr?: string;
}

export interface TextContent {
  body: LocalizedValue;
}

export interface Caption {
  language: 'ar' | 'en' | 'tr';
  url: string;
  label?: string;
}

export type VideoContent =
  | { provider: 'file'; url: string; durationSeconds: number; captions: Caption[] }
  | { provider: 'youtube'; videoId: string; url: string; durationSeconds: number | null }
  | { provider: 'vimeo'; videoId: string; url: string; durationSeconds: number | null };

export interface AudioContent {
  url: string;
  durationSeconds: number;
}

export interface PdfContent {
  url: string;
}

export interface ImageContent {
  url: string;
  alt: LocalizedValue | null;
}

export interface FileContent {
  url: string;
  fileName: string | null;
}

export interface LiveContent {
  note: LocalizedValue | null;
}

export type LessonContent = TextContent | VideoContent | AudioContent | PdfContent | ImageContent | FileContent | LiveContent;

export interface LessonResource {
  title: LocalizedValue;
  url: string;
}

// ---------------------------------------------------------------------------
// Write-side schemas (input → stored shape)
// ---------------------------------------------------------------------------

const textInput = z.object({ body: localized(TEXT_BODY_MAX) }).strict();

const videoInput = z
  .object({
    provider: z.enum(VIDEO_PROVIDERS),
    url: httpsUrl,
    durationSeconds: mediaSeconds.nullable().optional(),
    captions: z.array(captionSchema).max(CAPTIONS_MAX).optional(),
  })
  .strict()
  .transform((value, ctx): VideoContent => {
    if (value.provider === 'file') {
      if (value.durationSeconds === undefined || value.durationSeconds === null) {
        ctx.addIssue({ code: 'custom', path: ['durationSeconds'], message: 'a file video needs its length in seconds (D-R134)' });
        return z.NEVER;
      }
      return { provider: 'file', url: value.url, durationSeconds: value.durationSeconds, captions: value.captions ?? [] };
    }
    if (value.captions !== undefined && value.captions.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['captions'], message: 'captions are only for a file video; the provider’s player shows its own' });
      return z.NEVER;
    }
    const videoId = value.provider === 'youtube' ? youtubeIdOf(value.url) : vimeoIdOf(value.url);
    if (videoId === null) {
      ctx.addIssue({ code: 'custom', path: ['url'], message: `not a ${value.provider} video URL` });
      return z.NEVER;
    }
    const url = value.provider === 'youtube' ? `https://www.youtube.com/watch?v=${videoId}` : `https://vimeo.com/${videoId}`;
    return { provider: value.provider, videoId, url, durationSeconds: value.durationSeconds ?? null };
  });

const audioInput = z.object({ url: httpsUrl, durationSeconds: mediaSeconds }).strict();
const pdfInput = z.object({ url: httpsUrl }).strict();
const imageInput = z
  .object({ url: httpsUrl, alt: localized(SHORT_TEXT_MAX).nullable().optional() })
  .strict()
  .transform((value): ImageContent => ({ url: value.url, alt: value.alt ?? null }));
const fileInput = z
  .object({ url: httpsUrl, fileName: z.string().trim().min(1).max(200).nullable().optional() })
  .strict()
  .transform((value): FileContent => ({ url: value.url, fileName: value.fileName ?? null }));
const liveInput = z
  .object({ note: localized(TEXT_BODY_MAX).nullable().optional() })
  .strict()
  .transform((value): LiveContent => ({ note: value.note ?? null }));

const CONTENT_SCHEMAS: Record<LearningItemKind, z.ZodType<LessonContent>> = {
  text: textInput,
  video: videoInput,
  audio: audioInput,
  pdf: pdfInput,
  image: imageInput,
  file: fileInput,
  live: liveInput,
};

export const resourcesSchema = z
  .array(z.object({ title: localized(SHORT_TEXT_MAX), url: httpsUrl }).strict())
  .max(RESOURCES_MAX);

export type ContentCheck = { ok: true; content: LessonContent | null } | { ok: false; problems: string[] };

function problemsOf(error: z.ZodError): string[] {
  return error.issues.map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
}

/**
 * The content to store for `kind`, or the problems that refuse it. `null`
 * (no content yet) is accepted for every kind: such a lesson shows its
 * description and completes by the explicit action.
 */
export function parseLessonContent(kind: LearningItemKind, input: unknown): ContentCheck {
  if (input === null || input === undefined) return { ok: true, content: null };
  const parsed = CONTENT_SCHEMAS[kind].safeParse(input);
  return parsed.success ? { ok: true, content: parsed.data } : { ok: false, problems: problemsOf(parsed.error) };
}

export type ResourcesCheck = { ok: true; resources: LessonResource[] } | { ok: false; problems: string[] };

export function parseLessonResources(input: unknown): ResourcesCheck {
  if (input === null || input === undefined) return { ok: true, resources: [] };
  const parsed = resourcesSchema.safeParse(input);
  return parsed.success ? { ok: true, resources: parsed.data } : { ok: false, problems: problemsOf(parsed.error) };
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

/** Lenient read: the stored content of `kind` re-checked by the write schema (it is idempotent on its own output); anything else is null. */
export function readLessonContent(kind: LearningItemKind, stored: unknown): LessonContent | null {
  if (stored === null || stored === undefined || typeof stored !== 'object' || Array.isArray(stored)) return null;
  // A stored youtube/vimeo video carries `videoId`; the write schema is strict, so re-check its input shape.
  const input = kind === 'video' ? videoInputOfStored(stored as Record<string, unknown>) : stored;
  const check = parseLessonContent(kind, input);
  return check.ok ? check.content : null;
}

function videoInputOfStored(stored: Record<string, unknown>): Record<string, unknown> {
  const { videoId: _videoId, ...rest } = stored;
  return rest;
}

export function readLessonResources(stored: unknown): LessonResource[] {
  const check = parseLessonResources(stored);
  return check.ok ? check.resources : [];
}

// ---------------------------------------------------------------------------
// Completion (D-R134)
// ---------------------------------------------------------------------------

/**
 * How a lesson completes: `playback` — enough of a measurable medium played
 * (a `file` video, audio); `attendance` — a live lesson completes when the
 * learner was present or late at a session covering it (computed on read);
 * `manual` — the learner's explicit «mark as complete» (text, PDF, image,
 * file, an embedded YouTube/Vimeo video the academy cannot measure, and a
 * lesson whose content is not there yet).
 */
export type CompletionMode = 'manual' | 'playback' | 'attendance';

export function completionModeOf(kind: LearningItemKind, content: LessonContent | null): CompletionMode {
  if (kind === 'live') return 'attendance';
  if (content === null) return 'manual';
  if (kind === 'audio') return 'playback';
  if (kind === 'video' && (content as VideoContent).provider === 'file') return 'playback';
  return 'manual';
}

/** The authored media length that playback coverage is measured against; null for anything not measured. */
export function playbackDurationOf(kind: LearningItemKind, content: LessonContent | null): number | null {
  if (completionModeOf(kind, content) !== 'playback') return null;
  return (content as AudioContent | Extract<VideoContent, { provider: 'file' }>).durationSeconds;
}

/** The length to show in the curriculum: the media's own length when known, else the author's estimate. */
export function displayDurationSecondsOf(kind: LearningItemKind, content: LessonContent | null, estimatedMinutes: number | null): number | null {
  if (content !== null && (kind === 'video' || kind === 'audio')) {
    const seconds = (content as { durationSeconds?: number | null }).durationSeconds;
    if (typeof seconds === 'number') return seconds;
  }
  return estimatedMinutes === null ? null : estimatedMinutes * 60;
}
