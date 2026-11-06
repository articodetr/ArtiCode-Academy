// Clock times and calendar dates of the weekly schedule (MOD-07-T03), pure and
// unit-tested in schedule.changes.spec.ts. Slots store local wall-clock times
// (`time(0)`) and calendar dates (`date`) — no time zone until lessons are
// generated (T05, §4e.8 (4)). The API exchanges `HH:MM` and `YYYY-MM-DD`.
import { registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';

/** `HH:MM`, 00:00–23:59. */
export const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && CLOCK_TIME_PATTERN.test(value);
}

/** Minutes since midnight of an `HH:MM` value (for comparisons). */
export function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours! * 60 + minutes!;
}

/** `HH:MM` → the `time(0)` column (Prisma represents it on 1970-01-01 UTC). */
export function clockTimeToColumn(value: string): Date {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

/** The `time(0)` column → `HH:MM`. */
export function columnToClockTime(value: Date): string {
  return value.toISOString().slice(11, 16);
}

/** `YYYY-MM-DD` → the `date` column (midnight UTC, as users.validation's calendarDateToDate). */
export function calendarDateToColumn(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** The `date` column → `YYYY-MM-DD`. */
export function columnToCalendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Half-open time ranges `[start, end)`: adjacent slots (10–11 and 11–12) do not overlap — as the EXCLUDE constraint. */
export function clockRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return clockMinutes(aStart) < clockMinutes(bEnd) && clockMinutes(bStart) < clockMinutes(aEnd);
}

/** Inclusive date ranges; `null` end = open-ended — as `daterange(from, to, '[]')` in the EXCLUDE constraint. */
export function dateRangesOverlap(aFrom: string, aTo: string | null, bFrom: string, bTo: string | null): boolean {
  return (aTo === null || aTo >= bFrom) && (bTo === null || bTo >= aFrom);
}

/**
 * Today's calendar date in a time zone (`YYYY-MM-DD`), for closing the open
 * slots of a completed or cancelled class (§4e.8 (3)). An unknown zone falls
 * back to UTC rather than failing the request.
 */
export function calendarDateIn(timeZone: string, now: Date = new Date()): string {
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
  try {
    return new Intl.DateTimeFormat('en-CA', { ...options, timeZone }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }).format(now);
  }
}

/** class-validator rule for `HH:MM` body fields. */
export function IsClockTime(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isClockTime',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be a time HH:MM (00:00–23:59)`, ...options },
      validator: { validate: (value: unknown) => isClockTime(value) },
    });
  };
}
