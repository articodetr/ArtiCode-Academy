// Instants of MOD-06 lessons (D-R33 (5)): `starts_at`/`ends_at` are
// `timestamptz` exchanged as ISO 8601 with an explicit offset or `Z`; the
// academy's (or the branch's) time zone is for display only. Pure helpers,
// unit-tested in lessons.time.spec.ts.
import { registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';

/** `YYYY-MM-DDTHH:MM[:SS[.fff]]` followed by `Z` or `±HH:MM` — an offset is required. */
export const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** A lesson lasts at most this long (D-R33 (5)). */
export const MAX_LESSON_HOURS = 12;

/**
 * True for a real instant written as ISO 8601 with an offset
 * (`2026-11-10T10:00:00+03:00`, `…Z`). The calendar day is checked on its own
 * because `Date.parse` rolls `2026-02-30` over to March instead of rejecting it.
 */
export function isInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) return false;
  if (Number.isNaN(Date.parse(value))) return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number) as [number, number, number];
  const calendar = new Date(Date.UTC(year, month - 1, day));
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
}

/** The instant as a Date (callers validate with `isInstant()` first). */
export function toInstant(value: string): Date {
  return new Date(value);
}

/** The column value as the API returns it (UTC, milliseconds). */
export function toIso(value: Date): string {
  return value.toISOString();
}

/**
 * Why a lesson's range is refused: `empty` when `endsAt` is not after
 * `startsAt`, `too_long` when it exceeds MAX_LESSON_HOURS; null when valid.
 */
export function timeRangeProblem(startsAt: Date, endsAt: Date, maxHours: number = MAX_LESSON_HOURS): 'empty' | 'too_long' | null {
  const span = endsAt.getTime() - startsAt.getTime();
  if (span <= 0) return 'empty';
  if (span > maxHours * 60 * 60 * 1000) return 'too_long';
  return null;
}

/** Half-open instants `[start, end)`: back-to-back lessons do not overlap — as the EXCLUDE constraints. */
export function instantsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** class-validator rule for ISO 8601 instants with an offset. */
export function IsInstant(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isInstant',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be an ISO 8601 instant with an offset (e.g. 2026-11-10T10:00:00+03:00)`, ...options },
      validator: { validate: (value: unknown) => isInstant(value) },
    });
  };
}
