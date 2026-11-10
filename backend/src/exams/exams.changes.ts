// Pure planning of an exam PATCH (MOD-09-T03), on the pattern of
// assignments.changes.ts: only fields whose value changes are written, an
// idempotent PATCH writes nothing and records nothing, and the audit metadata
// carries field names only. The class is fixed and the status changes through
// POST /api/exams/:id/status. Decimals are compared as their `numeric(p,2)`
// text, instants as ISO strings in UTC.
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { ExamType } from '../generated/prisma/client.js';

export const EXAM_PATCH_FIELDS = ['title', 'description', 'type', 'lessonId', 'scheduledAt', 'durationMinutes', 'maxScore', 'passScore', 'weight'] as const;
export type ExamPatchField = (typeof EXAM_PATCH_FIELDS)[number];

export interface ExamValues {
  title: LocalizedText;
  description: LocalizedText | null;
  type: ExamType;
  lessonId: string | null;
  /** ISO 8601 in UTC with milliseconds, or null. */
  scheduledAt: string | null;
  durationMinutes: number | null;
  /** `numeric(6,2)` text, e.g. `"20.00"`. */
  maxScore: string;
  /** `numeric(6,2)` text or null. */
  passScore: string | null;
  /** `numeric(5,2)` text or null. */
  weight: string | null;
}

export type ExamPatch = Partial<ExamValues>;

export interface ExamUpdatePlan {
  data: ExamPatch;
  fields: ExamPatchField[];
}

/** True when the body carries no field at all (`{}`). */
export function isEmptyExamPatch(patch: Partial<Record<ExamPatchField, unknown>>): boolean {
  return EXAM_PATCH_FIELDS.every((field) => patch[field] === undefined);
}

function sameValue(field: ExamPatchField, current: ExamValues, requested: unknown): boolean {
  if (field === 'title') return sameLocalizedText(current.title, requested as LocalizedText);
  if (field === 'description') {
    const next = requested as LocalizedText | null;
    if (current.description === null || next === null) return current.description === next;
    return sameLocalizedText(current.description, next);
  }
  return current[field] === requested;
}

export function planExamUpdate(current: ExamValues, patch: ExamPatch): ExamUpdatePlan {
  const data: ExamPatch = {};
  const fields: ExamPatchField[] = [];
  for (const field of EXAM_PATCH_FIELDS) {
    const requested = patch[field];
    if (requested === undefined) continue;
    if (sameValue(field, current, requested)) continue;
    (data as Record<string, unknown>)[field] = requested;
    fields.push(field);
  }
  return { data, fields };
}

/**
 * The pass score after applying the patch, or null when it is consistent:
 * it stays within the maximum score (CHECK `ck_exams_pass_score_range` is the
 * backstop).
 */
export function passScoreProblem(current: Pick<ExamValues, 'maxScore' | 'passScore'>, patch: ExamPatch): { passScore: number; maxScore: number } | null {
  const maxScore = Number(patch.maxScore ?? current.maxScore);
  const passScore = patch.passScore !== undefined ? patch.passScore : current.passScore;
  if (passScore !== null && Number(passScore) > maxScore) return { passScore: Number(passScore), maxScore };
  return null;
}
