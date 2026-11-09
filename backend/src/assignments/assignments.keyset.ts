// Keyset pagination of assignments on `(due_at NULLS LAST, id)` (MOD-08 —
// API-102 and API-112), as pure helpers unit-tested in
// my-assignments.policy.spec.ts. Assignments with a due date come first in
// the requested order, then the undated ones by id, in both orders. The
// opaque cursor (common/keyset-cursor.ts) carries the last row's due instant,
// or the empty string for a row without a due date.
import type { SortOrder } from '../common/keyset-cursor.js';
import type { Prisma } from '../generated/prisma/client.js';

/** The list's sort key in the cursor (bound to the order by keyset-cursor.ts). */
export const ASSIGNMENT_SORT_FIELD = 'dueAt';

/** Cursor key of a row without a due date (sorted last in both orders). */
export const NO_DUE_DATE_KEY = '';

/** The cursor key of the last row of a page. */
export function dueCursorKey(dueAt: Date | null): string {
  return dueAt ? dueAt.toISOString() : NO_DUE_DATE_KEY;
}

/** `ORDER BY due_at <order> NULLS LAST, id <order>`. */
export function dueOrderBy(order: SortOrder): Prisma.AssignmentOrderByWithRelationInput[] {
  return [{ dueAt: { sort: order, nulls: 'last' } }, { id: order }];
}

/**
 * The rows after the cursor `(key, id)`: later due dates, the same due date
 * with a later id, then every undated row — or, inside the undated group, a
 * later id only. Null when the key is neither an instant nor the undated
 * marker (the caller answers `cursor_invalid`).
 */
export function afterDueCursor(key: string, id: string, order: SortOrder): Prisma.AssignmentWhereInput | null {
  const cmp = order === 'asc' ? 'gt' : 'lt';
  if (key === NO_DUE_DATE_KEY) return { dueAt: null, id: { [cmp]: id } };
  if (!Number.isFinite(Date.parse(key))) return null;
  const at = new Date(key);
  return { OR: [{ dueAt: { [cmp]: at } }, { dueAt: at, id: { [cmp]: id } }, { dueAt: null }] };
}
