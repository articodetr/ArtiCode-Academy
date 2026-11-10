// Keyset pagination of exams on `(scheduled_at NULLS LAST, id)` (MOD-09 —
// API-113 and API-121), as pure helpers unit-tested in exams.changes.spec.ts.
// The same shape as assignments.keyset.ts (due date → exam date): dated exams
// first in the requested order, then the undated ones by id, in both orders.
// The opaque cursor (common/keyset-cursor.ts) carries the last row's instant,
// or the empty string for a row without a date.
import type { SortOrder } from '../common/keyset-cursor.js';
import type { Prisma } from '../generated/prisma/client.js';

/** The list's sort key in the cursor (bound to the order by keyset-cursor.ts). */
export const EXAM_SORT_FIELD = 'scheduledAt';

/** Cursor key of a row without a date (sorted last in both orders). */
export const NO_EXAM_DATE_KEY = '';

/** The cursor key of the last row of a page. */
export function examCursorKey(scheduledAt: Date | null): string {
  return scheduledAt ? scheduledAt.toISOString() : NO_EXAM_DATE_KEY;
}

/** `ORDER BY scheduled_at <order> NULLS LAST, id <order>`. */
export function examOrderBy(order: SortOrder): Prisma.ExamOrderByWithRelationInput[] {
  return [{ scheduledAt: { sort: order, nulls: 'last' } }, { id: order }];
}

/**
 * The rows after the cursor `(key, id)`: later dates, the same date with a
 * later id, then every undated row — or, inside the undated group, a later id
 * only. Null when the key is neither an instant nor the undated marker.
 */
export function afterExamCursor(key: string, id: string, order: SortOrder): Prisma.ExamWhereInput | null {
  const cmp = order === 'asc' ? 'gt' : 'lt';
  if (key === NO_EXAM_DATE_KEY) return { scheduledAt: null, id: { [cmp]: id } };
  if (!Number.isFinite(Date.parse(key))) return null;
  const at = new Date(key);
  return { OR: [{ scheduledAt: { [cmp]: at } }, { scheduledAt: at, id: { [cmp]: id } }, { scheduledAt: null }] };
}
