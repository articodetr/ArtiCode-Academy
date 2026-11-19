// Learning progress of MOD-20 «My School» (roadmap §4q, D-R133..D-R135,
// ADR-078) as pure rules, unit-tested in learning.progress.spec.ts.
//
// Playback coverage (D-R134): a played medium reports the intervals it
// actually played since its previous save. Coverage is the length of the
// union of every interval ever played, never the furthest point reached, so
// seeking to the end plays (and credits) nothing. The newly covered seconds a
// save may add are capped by the server's own clock: at most twice the time
// since the later of the previous save and the last opening of the lesson
// (the player offers speeds up to 2×) plus a small
// allowance for the save cadence — a client claiming more has its new
// intervals trimmed, earliest first. This keeps an honest learner's record
// exact and bounds what a forged request can claim; it cannot prove a human
// watched, and the documentation says so.
//
// Progress (D-R135): only published lessons count; a course's percent is the
// required published lessons completed over all required published lessons,
// floored (99.6% never shows as 100%); `null` when the course has no required
// lesson — never a division by zero, never a false completion.

/** A closed-open played interval in whole seconds: [start, end). */
export type PlayedRange = [number, number];

/** Highest playback rate the player offers; the coverage cap follows it. */
export const MAX_PLAYBACK_RATE = 2;
/** Seconds of coverage a save may add on top of the clock (the client saves every 15 s and on pause). */
export const PLAYBACK_ALLOWANCE_SECONDS = 10;
/** Stored intervals are merged; at most this many survive (a learner who skips around a lot). */
export const STORED_RANGES_MAX = 200;
/** Ranges in one save. */
export const REPORTED_RANGES_MAX = 50;
/** Default share of a measured medium that completes it (academy setting `learning.videoCompletionPercent`). */
export const DEFAULT_COMPLETION_PERCENT = 90;

/** Clamps to [0, duration], rounds outward to whole seconds, drops empty intervals, sorts and merges touching ones. */
export function normalizeRanges(ranges: readonly (readonly [number, number])[], durationSeconds: number): PlayedRange[] {
  const clamped: PlayedRange[] = [];
  for (const [rawStart, rawEnd] of ranges) {
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
    const start = Math.max(0, Math.floor(Math.min(rawStart, rawEnd)));
    const end = Math.min(durationSeconds, Math.ceil(Math.max(rawStart, rawEnd)));
    if (end > start) clamped.push([start, end]);
  }
  clamped.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: PlayedRange[] = [];
  for (const range of clamped) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

export function rangesLength(ranges: readonly PlayedRange[]): number {
  return ranges.reduce((sum, [start, end]) => sum + (end - start), 0);
}

/** The parts of `ranges` not already inside `covered` (both normalised), in order. */
export function uncoveredParts(ranges: readonly PlayedRange[], covered: readonly PlayedRange[]): PlayedRange[] {
  const out: PlayedRange[] = [];
  for (const [start, end] of ranges) {
    let cursor = start;
    for (const [coveredStart, coveredEnd] of covered) {
      if (coveredEnd <= cursor) continue;
      if (coveredStart >= end) break;
      if (coveredStart > cursor) out.push([cursor, Math.min(coveredStart, end)]);
      cursor = Math.max(cursor, coveredEnd);
      if (cursor >= end) break;
    }
    if (cursor < end) out.push([cursor, end]);
  }
  return out;
}

/** Keeps the earliest new seconds up to `budget`, trimming the interval that crosses it. */
export function takeBudget(parts: readonly PlayedRange[], budget: number): PlayedRange[] {
  const out: PlayedRange[] = [];
  let left = Math.max(0, Math.floor(budget));
  for (const [start, end] of parts) {
    if (left <= 0) break;
    const length = end - start;
    if (length <= left) {
      out.push([start, end]);
      left -= length;
    } else {
      out.push([start, start + left]);
      left = 0;
    }
  }
  return out;
}

export interface StoredPlayback {
  ranges: PlayedRange[];
  /** The previous playback save; null before the first one. */
  lastPlaybackAt: Date | null;
  /** When the lesson was last opened — the clock's start before the first save and after every reopening. */
  lastOpenedAt: Date;
  completed: boolean;
}

export interface PlaybackReport {
  positionSeconds: number;
  ranges: readonly (readonly [number, number])[];
}

export interface PlaybackPlan {
  ranges: PlayedRange[];
  watchedSeconds: number;
  positionSeconds: number;
  /** Seconds this save added to the coverage after the cap. */
  creditedSeconds: number;
  /** True when the cap trimmed what the report claimed. */
  capped: boolean;
  /** True when this save completes the lesson (it was not complete before). */
  completes: boolean;
  watchedPercent: number;
}

/** Reads the stored `watched_ranges` jsonb leniently (anything malformed is dropped). */
export function readStoredRanges(stored: unknown, durationSeconds: number): PlayedRange[] {
  if (!Array.isArray(stored)) return [];
  const pairs: [number, number][] = [];
  for (const entry of stored) {
    if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'number' && typeof entry[1] === 'number') pairs.push([entry[0], entry[1]]);
  }
  return normalizeRanges(pairs, durationSeconds);
}

/** Integer percent of `part` over `whole`, floored; 0 when `whole` is 0. */
function floorPercent(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.floor((part * 100) / whole);
}

export function planPlayback(stored: StoredPlayback, report: PlaybackReport, durationSeconds: number, thresholdPercent: number, now: Date): PlaybackPlan {
  const reported = normalizeRanges(report.ranges, durationSeconds);
  const newParts = uncoveredParts(reported, stored.ranges);
  const claimed = rangesLength(newParts);
  // The clock starts at the later of the previous save and the last opening: a
  // lesson saved yesterday and opened again a second ago has played at most a
  // second since, not a day (else one save after a reopening could claim it all).
  const since = stored.lastPlaybackAt !== null && stored.lastPlaybackAt > stored.lastOpenedAt ? stored.lastPlaybackAt : stored.lastOpenedAt;
  const elapsedSeconds = Math.max(0, (now.getTime() - since.getTime()) / 1000);
  const budget = Math.floor(elapsedSeconds * MAX_PLAYBACK_RATE) + PLAYBACK_ALLOWANCE_SECONDS;
  const credited = takeBudget(newParts, budget);
  let ranges = normalizeRanges([...stored.ranges, ...credited], durationSeconds);
  if (ranges.length > STORED_RANGES_MAX) ranges = ranges.slice(0, STORED_RANGES_MAX);
  const watchedSeconds = Math.min(durationSeconds, rangesLength(ranges));
  const watchedPercent = floorPercent(watchedSeconds, durationSeconds);
  const positionSeconds = Math.min(durationSeconds, Math.max(0, Math.floor(Number.isFinite(report.positionSeconds) ? report.positionSeconds : 0)));
  return {
    ranges,
    watchedSeconds,
    positionSeconds,
    creditedSeconds: rangesLength(credited),
    capped: rangesLength(credited) < claimed,
    completes: !stored.completed && watchedPercent >= thresholdPercent,
    watchedPercent,
  };
}

// ---------------------------------------------------------------------------
// Course and level progress (computed on read — ADR-078)
// ---------------------------------------------------------------------------

export type LearningState = 'not_started' | 'in_progress' | 'completed';

export interface ProgressItem {
  id: string;
  isRequired: boolean;
}

export interface ItemState {
  state: LearningState;
  completedAt: Date | null;
}

export interface ProgressCounts {
  /** Published lessons in scope. */
  total: number;
  required: number;
  /** Lessons in scope completed, required or not. */
  completed: number;
  completedRequired: number;
  /** completedRequired ÷ required, floored; null without a required lesson. */
  percent: number | null;
  /** Every required lesson completed (false without a required lesson). */
  isComplete: boolean;
  /** The latest completion among the required lessons once complete; else null. */
  completedAt: Date | null;
}

export function progressOf(items: readonly ProgressItem[], states: ReadonlyMap<string, ItemState>): ProgressCounts {
  let completed = 0;
  let required = 0;
  let completedRequired = 0;
  let latest: Date | null = null;
  for (const item of items) {
    const state = states.get(item.id);
    const done = state?.state === 'completed';
    if (done) completed += 1;
    if (!item.isRequired) continue;
    required += 1;
    if (!done) continue;
    completedRequired += 1;
    const at = state?.completedAt ?? null;
    if (at !== null && (latest === null || at > latest)) latest = at;
  }
  const isComplete = required > 0 && completedRequired === required;
  return {
    total: items.length,
    required,
    completed,
    completedRequired,
    percent: required === 0 ? null : floorPercent(completedRequired, required),
    isComplete,
    completedAt: isComplete ? latest : null,
  };
}

/** The learner's next step on a course card (D-R135): nothing opened yet, under way, or done. */
export type LearningAction = 'start' | 'continue' | 'review';

export function learningActionOf(hasHistory: boolean, progress: Pick<ProgressCounts, 'isComplete'>): LearningAction {
  if (progress.isComplete) return 'review';
  return hasHistory ? 'continue' : 'start';
}
