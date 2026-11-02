// Pure planning of a syllabus replacement (MOD-04-T04), unit-tested in
// syllabus.changes.spec.ts. `PUT /api/courses/:id/syllabus` sends the whole
// syllabus in order: items with an `id` keep their row (updated when a value
// differs), items without one are created, rows that are not listed are
// deleted, and every item's position becomes its index in the list. A list
// identical to the stored syllabus writes nothing and records nothing.
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';

export interface SyllabusItemValues {
  title: LocalizedText;
  description: LocalizedText | null;
  estimatedMinutes: number | null;
}

export interface ExistingSyllabusItem extends SyllabusItemValues {
  id: string;
  sortOrder: number;
}

export interface RequestedSyllabusItem extends SyllabusItemValues {
  id?: string;
}

export interface SyllabusItemUpdate extends Partial<SyllabusItemValues> {
  id: string;
  sortOrder?: number;
}

export interface SyllabusCounts {
  added: number;
  /** Kept items whose title, description or minutes changed. */
  updated: number;
  removed: number;
  /** True when the relative order of the kept items changed. */
  reordered: boolean;
}

export type SyllabusPlan =
  | {
      ok: true;
      /** False when nothing differs (no write, no event). */
      changed: boolean;
      create: (SyllabusItemValues & { sortOrder: number })[];
      update: SyllabusItemUpdate[];
      remove: string[];
      counts: SyllabusCounts;
    }
  | { ok: false; unknown: string[]; duplicates: string[] };

export function planSyllabusReplacement(existing: readonly ExistingSyllabusItem[], requested: readonly RequestedSyllabusItem[]): SyllabusPlan {
  const byId = new Map(existing.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const unknown: string[] = [];
  const duplicates = new Set<string>();
  for (const item of requested) {
    if (item.id === undefined) continue;
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
    if (!byId.has(item.id)) unknown.push(item.id);
  }
  if (unknown.length > 0 || duplicates.size > 0) return { ok: false, unknown: [...new Set(unknown)], duplicates: [...duplicates] };

  const create: (SyllabusItemValues & { sortOrder: number })[] = [];
  const update: SyllabusItemUpdate[] = [];
  let updated = 0;
  requested.forEach((item, sortOrder) => {
    const values: SyllabusItemValues = { title: item.title, description: item.description, estimatedMinutes: item.estimatedMinutes };
    if (item.id === undefined) {
      create.push({ ...values, sortOrder });
      return;
    }
    const current = byId.get(item.id)!;
    const change: SyllabusItemUpdate = { id: item.id };
    let contentChanged = false;
    if (!sameLocalizedText(current.title, values.title)) {
      change.title = values.title;
      contentChanged = true;
    }
    if (!sameLocalizedText(current.description, values.description)) {
      change.description = values.description;
      contentChanged = true;
    }
    if (current.estimatedMinutes !== values.estimatedMinutes) {
      change.estimatedMinutes = values.estimatedMinutes;
      contentChanged = true;
    }
    if (current.sortOrder !== sortOrder) change.sortOrder = sortOrder;
    if (contentChanged) updated += 1;
    if (Object.keys(change).length > 1) update.push(change);
  });
  const remove = existing.filter((item) => !seen.has(item.id)).map((item) => item.id);

  const keptBefore = [...existing].sort((a, b) => a.sortOrder - b.sortOrder).filter((item) => seen.has(item.id)).map((item) => item.id);
  const keptAfter = requested.flatMap((item) => (item.id === undefined ? [] : [item.id]));
  const reordered = keptBefore.some((id, index) => keptAfter[index] !== id);

  const changed = create.length > 0 || update.length > 0 || remove.length > 0;
  return { ok: true, changed, create, update, remove, counts: { added: create.length, updated, removed: remove.length, reordered } };
}
