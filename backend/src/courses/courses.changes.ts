// Pure planning of a course PATCH (MOD-04-T03), on the pattern of
// academy.changes.ts / levels.changes.ts: only fields whose value changes are
// written, an idempotent PATCH writes nothing and records nothing, and the
// audit metadata carries field names only. The status is not patchable here
// (POST /api/courses/:id/status).
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';

export const COURSE_PATCH_FIELDS = [
  'code',
  'name',
  'summary',
  'description',
  'levelId',
  'durationHours',
  'sessionsCount',
  'minAge',
  'maxAge',
] as const;
export type CoursePatchField = (typeof COURSE_PATCH_FIELDS)[number];

const LOCALIZED: ReadonlySet<CoursePatchField> = new Set<CoursePatchField>(['name', 'summary', 'description']);

export interface CourseValues {
  code: string;
  name: LocalizedText;
  summary: LocalizedText | null;
  description: LocalizedText | null;
  levelId: string | null;
  /** Kept as the decimal string of numeric(6,1) (e.g. "12.5") so equality is exact. */
  durationHours: string | null;
  sessionsCount: number | null;
  minAge: number | null;
  maxAge: number | null;
}

export type CoursePatch = Partial<CourseValues>;

export interface CourseUpdatePlan {
  data: CoursePatch;
  fields: CoursePatchField[];
}

/** True when the body carries no field at all (`{}`). */
export function isEmptyCoursePatch(patch: Partial<Record<CoursePatchField, unknown>>): boolean {
  return COURSE_PATCH_FIELDS.every((field) => patch[field] === undefined);
}

/** numeric(6,1) as a canonical string: 12 → "12.0", "12.50" → "12.5". */
export function hoursToDecimalString(value: number | string | null): string | null {
  if (value === null) return null;
  return Number(value).toFixed(1);
}

export function planCourseUpdate(current: CourseValues, patch: CoursePatch): CourseUpdatePlan {
  const data: CoursePatch = {};
  const fields: CoursePatchField[] = [];
  for (const field of COURSE_PATCH_FIELDS) {
    const requested = patch[field];
    if (requested === undefined) continue;
    const unchanged = LOCALIZED.has(field)
      ? sameLocalizedText(current[field] as LocalizedText | null, requested as LocalizedText | null)
      : current[field] === requested;
    if (unchanged) continue;
    (data as Record<string, unknown>)[field] = requested;
    fields.push(field);
  }
  return { data, fields };
}

/** The age range after applying the patch; null when it is consistent. */
export function invalidAgeRange(current: Pick<CourseValues, 'minAge' | 'maxAge'>, patch: CoursePatch): { minAge: number; maxAge: number } | null {
  const minAge = patch.minAge !== undefined ? patch.minAge : current.minAge;
  const maxAge = patch.maxAge !== undefined ? patch.maxAge : current.maxAge;
  if (minAge !== null && maxAge !== null && maxAge < minAge) return { minAge, maxAge };
  return null;
}
