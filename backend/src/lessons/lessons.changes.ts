// Pure planning of a lesson PATCH (MOD-06-T02), on the pattern of
// classes.changes.ts: only fields whose value changes are written, an
// idempotent PATCH writes nothing and records nothing, and the audit metadata
// carries field names only. The class is fixed and the status changes through
// POST /api/lessons/:id/status. Instants are compared as ISO strings in UTC
// (the column value), so equality is a plain string comparison.
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { DeliveryMode } from '../generated/prisma/client.js';

export const LESSON_PATCH_FIELDS = ['title', 'description', 'deliveryMode', 'startsAt', 'endsAt', 'roomId', 'teacherUserId', 'syllabusItemId', 'meetingUrl'] as const;
export type LessonPatchField = (typeof LESSON_PATCH_FIELDS)[number];

export interface LessonValues {
  title: LocalizedText;
  description: LocalizedText | null;
  deliveryMode: DeliveryMode;
  /** ISO 8601 in UTC with milliseconds (`Date#toISOString()`). */
  startsAt: string;
  endsAt: string;
  roomId: string | null;
  teacherUserId: string | null;
  syllabusItemId: string | null;
  meetingUrl: string | null;
}

export type LessonPatch = Partial<LessonValues>;

export interface LessonUpdatePlan {
  data: LessonPatch;
  fields: LessonPatchField[];
}

/** True when the body carries no field at all (`{}`). */
export function isEmptyLessonPatch(patch: Partial<Record<LessonPatchField, unknown>>): boolean {
  return LESSON_PATCH_FIELDS.every((field) => patch[field] === undefined);
}

function sameValue(field: LessonPatchField, current: LessonValues, requested: unknown): boolean {
  if (field === 'title') return sameLocalizedText(current.title, requested as LocalizedText);
  if (field === 'description') {
    const next = requested as LocalizedText | null;
    if (current.description === null || next === null) return current.description === next;
    return sameLocalizedText(current.description, next);
  }
  return current[field] === requested;
}

export function planLessonUpdate(current: LessonValues, patch: LessonPatch): LessonUpdatePlan {
  const data: LessonPatch = {};
  const fields: LessonPatchField[] = [];
  for (const field of LESSON_PATCH_FIELDS) {
    const requested = patch[field];
    if (requested === undefined) continue;
    if (sameValue(field, current, requested)) continue;
    (data as Record<string, unknown>)[field] = requested;
    fields.push(field);
  }
  return { data, fields };
}

/** The time range after applying the patch (both ISO strings), for the range check. */
export function mergedRange(current: Pick<LessonValues, 'startsAt' | 'endsAt'>, patch: LessonPatch): { startsAt: string; endsAt: string } {
  return {
    startsAt: patch.startsAt !== undefined ? patch.startsAt : current.startsAt,
    endsAt: patch.endsAt !== undefined ? patch.endsAt : current.endsAt,
  };
}
