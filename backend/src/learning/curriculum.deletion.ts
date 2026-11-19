// D-R135 (MOD-20 «My School»): a lesson some learner has progress on is never
// deleted — the author unpublishes it instead. Shared by the curriculum PUT
// (API-227) and the flat syllabus PUT (API-049, courses/syllabus.service.ts),
// both of which call it inside their transaction, after the course-row lock
// and before any write. The `learning_progress` foreign key is Restrict, so a
// deletion that slipped past this check would fail anyway — this turns it into
// the stable `409 lesson_has_progress { itemIds }` instead of a 500.
import type { Prisma } from '../generated/prisma/client.js';
import { learningError } from './learning.errors.js';

/**
 * Refuses the deletion of `itemIds` when a learner has progress on any of
 * them. The lessons are locked `FOR UPDATE` first: a learner's first progress
 * row on a lesson takes a key-share lock on it (its foreign-key check), so a
 * row being written now is committed — and counted — before the check reads,
 * and one written after it waits for this transaction and then fails.
 */
export async function assertNoProgressOnDeletion(tx: Prisma.TransactionClient, itemIds: readonly string[]): Promise<void> {
  if (itemIds.length === 0) return;
  const ids = [...itemIds];
  await tx.$queryRaw`SELECT id FROM course_syllabus_items WHERE id = ANY(${ids}::uuid[]) FOR UPDATE`;
  const rows = await tx.learningProgress.findMany({
    where: { syllabusItemId: { in: ids } },
    distinct: ['syllabusItemId'],
    select: { syllabusItemId: true },
  });
  if (rows.length === 0) return;
  const studied = new Set(rows.map((row) => row.syllabusItemId));
  throw learningError.lessonHasProgress(ids.filter((id) => studied.has(id)));
}
