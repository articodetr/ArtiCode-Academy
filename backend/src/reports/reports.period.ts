import type { PrismaClient } from '../generated/prisma/client.js';
import { addDays, inclusiveDays, zonedInstant } from '../schedule/lesson-generation.plan.js';
import { calendarDateIn } from '../schedule/schedule.time.js';
import { reportsError } from './reports.errors.js';
import { DEFAULT_PERIOD_DAYS, MAX_PERIOD_DAYS } from './reports.policy.js';

/** Two calendar days, both inclusive, in the academy's zone (D-R69). */
export interface ReportPeriod {
  from: string;
  to: string;
}

/** The period and its half-open instant window [start of `from`, start of the day after `to`). */
export interface PeriodWindow {
  period: ReportPeriod;
  start: Date;
  end: Date;
}

/** What every report reads once per request. */
export interface ReportContext {
  timeZone: string;
  today: string;
  generatedAt: string;
}

/**
 * D-R69: an absent `to` is today in the academy's zone and an absent `from`
 * the day that makes a 30-day period with it; `from` after `to` or more than
 * 366 inclusive days is `400 report_range_invalid`. The days are already real
 * calendar dates (`IsCalendarDate` on the query).
 */
export function resolvePeriod(query: { from?: string; to?: string }, today: string): ReportPeriod {
  const to = query.to ?? today;
  const from = query.from ?? addDays(to, -(DEFAULT_PERIOD_DAYS - 1));
  const days = inclusiveDays(from, to);
  if (days < 1 || days > MAX_PERIOD_DAYS) throw reportsError.rangeInvalid(from, to, MAX_PERIOD_DAYS);
  return { from, to };
}

/**
 * The instants of a period in a zone: the first moment of `from` and of the
 * day after `to` (a day of 23 or 25 hours stays whole; a midnight inside a
 * daylight-saving gap moves forward, as `zonedInstant()` does for lessons).
 */
export function periodWindow(period: ReportPeriod, timeZone: string): PeriodWindow {
  return {
    period,
    start: zonedInstant(period.from, '00:00', timeZone),
    end: zonedInstant(addDays(period.to, 1), '00:00', timeZone),
  };
}

/** The academy's zone (UTC without the academy row), today in it and the answer's timestamp. */
export async function readReportContext(db: Pick<PrismaClient, 'academy'>, now: Date = new Date()): Promise<ReportContext> {
  const academy = await db.academy.findFirst({ select: { timezone: true } });
  const timeZone = academy?.timezone ?? 'UTC';
  return { timeZone, today: calendarDateIn(timeZone, now), generatedAt: now.toISOString() };
}
