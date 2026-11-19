// The learner's side of MOD-20 «My School» (roadmap §4q, API-229..234,
// D-R132..D-R135) as pure rules, unit-tested in my-learning.policy.spec.ts.
//
// - Access (D-R132): a learner opens a course's content only with an OWN
//   `active` or `completed` enrollment in a class of the course; with several,
//   the active one is preferred, then the newest. A caller whose only own
//   enrollment is a request awaiting approval (`pending`) is told so; a
//   guardian is refused like anybody else without an own enrollment — the
//   children's progress is read on «My School» (API-229), never the content.
// - The academy threshold of a playback lesson is
//   `settings.learning.videoCompletionPercent` (an integer 50..100), read
//   defensively from the stored jsonb: anything else is the default 90.
import type { MyClassRelation } from '../enrollments/my-classes.policy.js';
import type { EnrollmentStatus } from '../generated/prisma/client.js';
import { MEDIA_SECONDS_MAX } from './learning.content.js';
import { DEFAULT_COMPLETION_PERCENT, REPORTED_RANGES_MAX } from './learning.progress.js';

/** «My School» lists at most this many enrollments (no pagination). */
export const MY_LEARNING_ITEMS_MAX = 200;
export const COMPLETION_PERCENT_MIN = 50;
export const COMPLETION_PERCENT_MAX = 100;
/** Seconds of a played medium in a playback save (MEDIA_SECONDS_MAX = 24 h). */
export const PLAYBACK_SECONDS_MAX = MEDIA_SECONDS_MAX;

/** True for `[[start, end], …]`: at most REPORTED_RANGES_MAX pairs of finite JSON numbers in 0..PLAYBACK_SECONDS_MAX (API-233). */
export function isPlaybackRanges(value: unknown): value is [number, number][] {
  if (!Array.isArray(value) || value.length > REPORTED_RANGES_MAX) return false;
  return value.every(
    (pair) =>
      Array.isArray(pair) &&
      pair.length === 2 &&
      pair.every((second) => typeof second === 'number' && Number.isFinite(second) && second >= 0 && second <= PLAYBACK_SECONDS_MAX),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The academy's completion threshold for playback lessons, from the stored `academy.settings` jsonb. */
export function completionPercentOf(settings: unknown): number {
  const learning = isRecord(settings) ? settings['learning'] : undefined;
  const value = isRecord(learning) ? learning['videoCompletionPercent'] : undefined;
  return typeof value === 'number' && Number.isInteger(value) && value >= COMPLETION_PERCENT_MIN && value <= COMPLETION_PERCENT_MAX ? value : DEFAULT_COMPLETION_PERCENT;
}

export interface AccessEnrollment {
  id: string;
  status: EnrollmentStatus;
  enrolledAt: Date;
}

export type LearningAccess<T extends AccessEnrollment> =
  | { allowed: true; enrollment: T; /** every own active/completed enrollment of the course, the chosen one first */ owned: T[] }
  | { allowed: false; reason: 'pending' | 'not_enrolled' };

function newestFirst(a: AccessEnrollment, b: AccessEnrollment): number {
  return b.enrolledAt.getTime() - a.enrolledAt.getTime() || b.id.localeCompare(a.id);
}

/** The access decision from the caller's OWN enrollments in the classes of one course. */
export function learningAccessOf<T extends AccessEnrollment>(rows: readonly T[]): LearningAccess<T> {
  const owned = rows.filter((row) => row.status === 'active' || row.status === 'completed');
  if (owned.length === 0) return { allowed: false, reason: rows.some((row) => row.status === 'pending') ? 'pending' : 'not_enrolled' };
  const ordered = [...owned].sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || newestFirst(a, b));
  return { allowed: true, enrollment: ordered[0]!, owned: ordered };
}

/** floor(watched ÷ duration × 100), at most 100; null without a measured length. */
export function watchedPercentOf(watchedSeconds: number, durationSeconds: number | null): number | null {
  if (durationSeconds === null || durationSeconds <= 0) return null;
  return Math.min(100, Math.floor((Math.max(0, watchedSeconds) * 100) / durationSeconds));
}

/** The latest opening or completion among the states; null when there is none. */
export function lastActivityOf(states: Iterable<{ lastOpenedAt: Date | null; completedAt: Date | null }>): Date | null {
  let latest: Date | null = null;
  for (const state of states) {
    for (const at of [state.lastOpenedAt, state.completedAt]) {
      if (at !== null && (latest === null || at > latest)) latest = at;
    }
  }
  return latest;
}

export interface MyLearningSortKey {
  relation: MyClassRelation;
  lastActivityAt: Date | null;
  enrolledAt: Date;
  enrollmentId: string;
}

/** `self` before `child`, then the latest activity first (none last), then the newest enrollment. */
export function compareMyLearning(a: MyLearningSortKey, b: MyLearningSortKey): number {
  const relation = Number(a.relation === 'child') - Number(b.relation === 'child');
  if (relation !== 0) return relation;
  const aAt = a.lastActivityAt?.getTime() ?? null;
  const bAt = b.lastActivityAt?.getTime() ?? null;
  if (aAt !== bAt) {
    if (aAt === null) return 1;
    if (bAt === null) return -1;
    return bAt - aAt;
  }
  return b.enrolledAt.getTime() - a.enrolledAt.getTime() || b.enrollmentId.localeCompare(a.enrollmentId);
}
