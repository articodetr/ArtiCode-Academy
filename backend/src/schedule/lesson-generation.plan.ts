// Pure planning of lesson generation from the weekly schedule (MOD-07-T05,
// API-092 — roadmap §4e.5 T05, D-R29), unit-tested in
// lesson-generation.plan.spec.ts. A slot stores a local wall-clock time and a
// weekday; a lesson stores instants. The conversion runs on `Intl` alone (no
// dependency): the slot's time zone is its room's branch zone, else the
// academy's. A wall time inside a spring-forward gap is moved forward by the
// gap; an ambiguous wall time of a fall-back overlap takes the later instant
// (standard time). Generation is repeatable: a (slot, local date) pair that
// already holds a lesson — whatever its status — is skipped, and so are the
// dates outside `settings.scheduling.workingDays`.
import { calendarDateIn } from './schedule.time.js';

/** Longest inclusive range one request may generate (≈ 6 months — roadmap §4e.5 T05). */
export const GENERATION_MAX_DAYS = 184;

export interface GenerationSlot {
  id: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** `HH:MM` local wall-clock time. */
  startTime: string;
  endTime: string;
  roomId: string | null;
  teacherUserId: string | null;
  /** `YYYY-MM-DD`, inclusive. */
  effectiveFrom: string;
  /** `YYYY-MM-DD`, inclusive; null = open-ended. */
  effectiveTo: string | null;
  /** IANA zone the wall-clock times are read in. */
  timeZone: string;
}

export interface PlannedLesson {
  slotId: string;
  /** The local calendar date the lesson falls on. */
  date: string;
  timeZone: string;
  startsAt: Date;
  endsAt: Date;
  roomId: string | null;
  teacherUserId: string | null;
}

export interface GenerationPlan {
  /** Lessons to create, by start instant then slot id. */
  lessons: PlannedLesson[];
  /** Slot occurrences inside the range (before any skipping). */
  occurrences: number;
  /** Occurrences skipped because a lesson of that slot already exists on that local date. */
  existing: number;
  /** Occurrences skipped because the date is outside the academy's working days. */
  offDays: number;
}

const DAY_MS = 86_400_000;

function utcMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

/** 0 = Sunday … 6 = Saturday of a `YYYY-MM-DD` date. */
export function weekdayOf(date: string): number {
  return new Date(utcMidnight(date)).getUTCDay();
}

/** The date `days` after `date` (`YYYY-MM-DD`). */
export function addDays(date: string, days: number): string {
  return new Date(utcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive number of days from `from` to `to` (1 for the same day; 0 or less when `to` precedes `from`). */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS) + 1;
}

/** Every date from `from` to `to`, inclusive, in order. */
export function datesBetween(from: string, to: string): string[] {
  const days = inclusiveDays(from, to);
  return days <= 0 ? [] : Array.from({ length: days }, (_, index) => addDays(from, index));
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Offset of the zone at an instant, in milliseconds (local wall time minus UTC; +3 h for Asia/Riyadh = 10_800_000). */
export function zoneOffsetAt(timeZone: string, instant: Date): number {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const wall = Date.UTC(field('year'), field('month') - 1, field('day'), field('hour') % 24, field('minute'), field('second'));
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant of a local wall-clock time (`YYYY-MM-DD` + `HH:MM`) in a zone.
 * Two offset probes settle the ordinary case and both sides of a daylight-saving
 * transition; a wall time that does not exist (spring-forward gap) is moved
 * forward by the gap, and one that exists twice (fall-back overlap) resolves to
 * the later instant.
 */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  const wall = utcMidnight(date) + (hours * 60 + minutes) * 60_000;
  const first = wall - zoneOffsetAt(timeZone, new Date(wall));
  const offsetAtFirst = zoneOffsetAt(timeZone, new Date(first));
  const second = wall - offsetAtFirst;
  if (second === first) return new Date(first);
  const offsetAtSecond = zoneOffsetAt(timeZone, new Date(second));
  if (offsetAtSecond === offsetAtFirst) return new Date(second);
  // A gap: neither probe round-trips — take the later instant (the wall time shifted forward).
  return new Date(Math.max(first, second));
}

/** The local calendar date of an instant in a zone (the key generation compares existing lessons by). */
export function localDateOf(instant: Date, timeZone: string): string {
  return calendarDateIn(timeZone, instant);
}

/** Key of a (slot, local date) occurrence. */
export function occurrenceKey(slotId: string, date: string): string {
  return `${slotId}|${date}`;
}

/** True when the slot is effective on the date (inclusive range, open end). */
export function slotEffectiveOn(slot: Pick<GenerationSlot, 'effectiveFrom' | 'effectiveTo'>, date: string): boolean {
  return date >= slot.effectiveFrom && (slot.effectiveTo === null || date <= slot.effectiveTo);
}

/**
 * The lessons to generate for `slots` between `from` and `to` (inclusive):
 * every effective slot on every date of its weekday, minus the dates outside
 * `workingDays` (null = no restriction) and the occurrences already in
 * `existing` (keys from `occurrenceKey`).
 */
export function planGeneration(
  slots: readonly GenerationSlot[],
  from: string,
  to: string,
  workingDays: readonly number[] | null,
  existing: ReadonlySet<string>,
): GenerationPlan {
  const allowed = workingDays === null ? null : new Set(workingDays);
  const plan: GenerationPlan = { lessons: [], occurrences: 0, existing: 0, offDays: 0 };
  for (const date of datesBetween(from, to)) {
    const weekday = weekdayOf(date);
    for (const slot of slots) {
      if (slot.weekday !== weekday || !slotEffectiveOn(slot, date)) continue;
      plan.occurrences += 1;
      if (allowed !== null && !allowed.has(weekday)) {
        plan.offDays += 1;
        continue;
      }
      if (existing.has(occurrenceKey(slot.id, date))) {
        plan.existing += 1;
        continue;
      }
      plan.lessons.push({
        slotId: slot.id,
        date,
        timeZone: slot.timeZone,
        startsAt: zonedInstant(date, slot.startTime, slot.timeZone),
        endsAt: zonedInstant(date, slot.endTime, slot.timeZone),
        roomId: slot.roomId,
        teacherUserId: slot.teacherUserId,
      });
    }
  }
  plan.lessons.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));
  return plan;
}
