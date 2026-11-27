// A lesson's video and attachments (J-F77 — Galal's decision in the session,
// 2026-11-27) as pure rules, unit-tested in lessons.attachments.spec.ts. Both
// are pasted links: the academy stores no file (as MOD-20's content and a
// course's materials), so a link stays public at its host and the protection
// is who sees the lesson.
//
// - `recording_url` is the lesson's video (a recorded lesson's, or a live
//   lesson's recording afterwards): an https link like `meeting_url`.
// - `attachments` is a short list `[{ kind, title, url }]` — `book` (a
//   textbook or a handout, usually a PDF) or `link` (any other page) — with a
//   localized title and an https link, at most ATTACHMENTS_MAX. The write
//   side refuses a bad list (400 attachments_invalid { problems }); the read
//   side is lenient: a stored value that no longer fits reads as [].
//
// Neither is required by the server: the teacher's form asks for the join
// link of a live lesson and the video of a recorded one (the frontend), while
// lessons generated from the weekly schedule start without either.
import { z } from 'zod';
import type { LocalizedText } from '../authorization/localized-text.js';
import { SHORT_TEXT_MAX, httpsUrl, localized } from '../learning/learning.content.js';

export const ATTACHMENT_KINDS = ['book', 'link'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
export const ATTACHMENTS_MAX = 20;
export const ATTACHMENT_TITLE_MAX = SHORT_TEXT_MAX;

export interface LessonAttachment {
  kind: AttachmentKind;
  title: LocalizedText;
  url: string;
}

const attachmentsSchema = z
  .array(z.object({ kind: z.enum(ATTACHMENT_KINDS), title: localized(ATTACHMENT_TITLE_MAX), url: httpsUrl }).strict())
  .max(ATTACHMENTS_MAX);

export type AttachmentsCheck = { ok: true; attachments: LessonAttachment[] } | { ok: false; problems: string[] };

/** The list to store, normalised (trimmed, blank locales dropped, keys in one order), or the problems that refuse it. */
export function parseLessonAttachments(input: unknown): AttachmentsCheck {
  if (input === null || input === undefined) return { ok: true, attachments: [] };
  const parsed = attachmentsSchema.safeParse(input);
  if (parsed.success) return { ok: true, attachments: parsed.data.map((item) => ({ kind: item.kind, title: item.title, url: item.url })) };
  return { ok: false, problems: parsed.error.issues.map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message)) };
}

/** Lenient read of the stored column: what no longer fits reads as []. */
export function readLessonAttachments(stored: unknown): LessonAttachment[] {
  const check = parseLessonAttachments(stored);
  return check.ok ? check.attachments : [];
}

/** Two normalised lists are the same when every item matches in order (the PATCH planner's comparison). */
export function sameAttachments(a: readonly LessonAttachment[], b: readonly LessonAttachment[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
