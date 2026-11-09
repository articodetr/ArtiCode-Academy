// Pure planning of an assignment PATCH (MOD-08-T02), on the pattern of
// lessons.changes.ts: only fields whose value changes are written, an
// idempotent PATCH writes nothing and records nothing, and the audit metadata
// carries field names only. The class is fixed and the status changes through
// POST /api/assignments/:id/status. Decimals are compared as their
// `numeric(p,2)` text (`toFixed(2)`), instants as ISO strings in UTC.
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';

export const ASSIGNMENT_PATCH_FIELDS = [
  'title',
  'instructions',
  'lessonId',
  'maxScore',
  'weight',
  'dueAt',
  'allowLate',
  'latePenaltyPercent',
  'maxAttempts',
] as const;
export type AssignmentPatchField = (typeof ASSIGNMENT_PATCH_FIELDS)[number];

export interface AssignmentValues {
  title: LocalizedText;
  instructions: LocalizedText | null;
  lessonId: string | null;
  /** `numeric(6,2)` text, e.g. `"20.00"`. */
  maxScore: string;
  /** `numeric(5,2)` text or null. */
  weight: string | null;
  /** ISO 8601 in UTC with milliseconds, or null. */
  dueAt: string | null;
  allowLate: boolean;
  /** `numeric(5,2)` text or null. */
  latePenaltyPercent: string | null;
  maxAttempts: number;
}

export type AssignmentPatch = Partial<AssignmentValues>;

export interface AssignmentUpdatePlan {
  data: AssignmentPatch;
  fields: AssignmentPatchField[];
}

/** A JSON number as the column stores it (two decimals), or null. */
export function toDecimalText(value: number | string | null): string | null {
  if (value === null) return null;
  return Number(value).toFixed(2);
}

/** True when the body carries no field at all (`{}`). */
export function isEmptyAssignmentPatch(patch: Partial<Record<AssignmentPatchField, unknown>>): boolean {
  return ASSIGNMENT_PATCH_FIELDS.every((field) => patch[field] === undefined);
}

function sameValue(field: AssignmentPatchField, current: AssignmentValues, requested: unknown): boolean {
  if (field === 'title') return sameLocalizedText(current.title, requested as LocalizedText);
  if (field === 'instructions') {
    const next = requested as LocalizedText | null;
    if (current.instructions === null || next === null) return current.instructions === next;
    return sameLocalizedText(current.instructions, next);
  }
  return current[field] === requested;
}

export function planAssignmentUpdate(current: AssignmentValues, patch: AssignmentPatch): AssignmentUpdatePlan {
  const data: AssignmentPatch = {};
  const fields: AssignmentPatchField[] = [];
  for (const field of ASSIGNMENT_PATCH_FIELDS) {
    const requested = patch[field];
    if (requested === undefined) continue;
    if (sameValue(field, current, requested)) continue;
    (data as Record<string, unknown>)[field] = requested;
    fields.push(field);
  }
  return { data, fields };
}

/**
 * The late-submission policy after applying the patch, or null when it is
 * consistent: a late penalty needs `allowLate` (CHECK
 * `ck_assignments_late_penalty_only_allow_late` is the backstop).
 */
export function latePolicyProblem(current: Pick<AssignmentValues, 'allowLate' | 'latePenaltyPercent'>, patch: AssignmentPatch): { allowLate: boolean; latePenaltyPercent: number } | null {
  const allowLate = patch.allowLate !== undefined ? patch.allowLate : current.allowLate;
  const penalty = patch.latePenaltyPercent !== undefined ? patch.latePenaltyPercent : current.latePenaltyPercent;
  if (penalty !== null && !allowLate) return { allowLate, latePenaltyPercent: Number(penalty) };
  return null;
}
