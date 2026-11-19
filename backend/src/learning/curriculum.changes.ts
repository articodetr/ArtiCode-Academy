// Pure planning of a curriculum replacement (MOD-20 «My School», API-227 —
// roadmap §4q, D-R130/D-R135), unit-tested in curriculum.changes.spec.ts.
//
// `PUT /api/courses/:id/curriculum` sends the COMPLETE structure: the levels
// in order, each with its lessons in order, then the lessons outside every
// level. A level or lesson with an `id` keeps its row (updated when a value
// differs), one without an id is created, rows that are not listed are
// deleted. Every level's position becomes its index (0..n-1) and every
// lesson's position its index in the flattened learning order (the levels in
// order, then the loose lessons); a lesson's level becomes the level it is
// listed under (none for a loose lesson). A structure identical to the stored
// one writes nothing and records nothing.
//
// The lesson's kind, content and resources are not part of this plan
// (API-228 writes them); a new lesson starts as a `text` lesson without
// content.
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { CurriculumIdProblems } from './learning.errors.js';

export interface SectionValues {
  title: LocalizedText | null;
  description: LocalizedText | null;
}

export interface ExistingSection extends SectionValues {
  id: string;
  sortOrder: number;
}

export interface ItemValues {
  title: LocalizedText;
  description: LocalizedText | null;
  estimatedMinutes: number | null;
  isRequired: boolean;
  isPublished: boolean;
}

export interface ExistingItem extends ItemValues {
  id: string;
  sectionId: string | null;
  sortOrder: number;
}

export interface RequestedItem extends ItemValues {
  id?: string;
}

export interface RequestedSection extends SectionValues {
  id?: string;
  items: RequestedItem[];
}

export interface RequestedCurriculum {
  sections: RequestedSection[];
  looseItems: RequestedItem[];
}

/**
 * The level a lesson goes to: an existing level by id, a level this plan
 * creates (its index in `sections.create`), or none (a loose lesson).
 */
export type SectionTarget = { existingId: string } | { createIndex: number } | null;

export interface SectionCreate extends SectionValues {
  sortOrder: number;
}

export interface SectionUpdate extends Partial<SectionValues> {
  id: string;
  sortOrder?: number;
}

export interface ItemCreate extends ItemValues {
  sortOrder: number;
  section: SectionTarget;
}

export interface ItemUpdate extends Partial<ItemValues> {
  id: string;
  sortOrder?: number;
  /** Present only when the lesson changes level. */
  section?: SectionTarget;
}

export interface CurriculumCounts {
  sections: { added: number; updated: number; removed: number };
  /** `updated` = kept lessons whose values changed; `moved` = kept lessons now in another level (or in or out of the loose group). */
  items: { added: number; updated: number; removed: number; moved: number };
  /** True when the relative order of the kept levels, or of the kept lessons in learning order, changed. */
  reordered: boolean;
  totalSections: number;
  totalItems: number;
}

export type CurriculumPlan =
  | {
      ok: true;
      /** False when nothing differs (no write, no event). */
      changed: boolean;
      sections: { create: SectionCreate[]; update: SectionUpdate[]; remove: string[] };
      items: { create: ItemCreate[]; update: ItemUpdate[]; remove: string[] };
      counts: CurriculumCounts;
    }
  | ({ ok: false } & CurriculumIdProblems);

function idProblems(existingIds: ReadonlySet<string>, requestedIds: readonly (string | undefined)[]): { unknown: string[]; duplicates: string[]; seen: Set<string> } {
  const seen = new Set<string>();
  const unknown = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of requestedIds) {
    if (id === undefined) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
    if (!existingIds.has(id)) unknown.add(id);
  }
  return { unknown: [...unknown], duplicates: [...duplicates], seen };
}

function sameTarget(currentSectionId: string | null, target: SectionTarget): boolean {
  if (target === null) return currentSectionId === null;
  return 'existingId' in target && target.existingId === currentSectionId;
}

/** True when the kept ids appear in another relative order. */
function relativeOrderChanged(before: readonly string[], after: readonly string[]): boolean {
  const kept = new Set(after);
  const keptBefore = before.filter((id) => kept.has(id));
  return keptBefore.some((id, index) => after[index] !== id);
}

export function planCurriculumReplacement(
  existingSections: readonly ExistingSection[],
  existingItems: readonly ExistingItem[],
  requested: RequestedCurriculum,
): CurriculumPlan {
  const sectionById = new Map(existingSections.map((section) => [section.id, section]));
  const itemById = new Map(existingItems.map((item) => [item.id, item]));
  const requestedItems = [...requested.sections.flatMap((section) => section.items), ...requested.looseItems];

  const sectionIds = idProblems(new Set(sectionById.keys()), requested.sections.map((section) => section.id));
  const itemIds = idProblems(new Set(itemById.keys()), requestedItems.map((item) => item.id));
  if (sectionIds.unknown.length > 0 || sectionIds.duplicates.length > 0 || itemIds.unknown.length > 0 || itemIds.duplicates.length > 0) {
    return {
      ok: false,
      unknownSections: sectionIds.unknown,
      duplicateSections: sectionIds.duplicates,
      unknownItems: itemIds.unknown,
      duplicateItems: itemIds.duplicates,
    };
  }

  // Levels: position = index.
  const sectionCreate: SectionCreate[] = [];
  const sectionUpdate: SectionUpdate[] = [];
  const targets: SectionTarget[] = [];
  let sectionsUpdated = 0;
  requested.sections.forEach((section, sortOrder) => {
    const values: SectionValues = { title: section.title, description: section.description };
    if (section.id === undefined) {
      targets.push({ createIndex: sectionCreate.length });
      sectionCreate.push({ ...values, sortOrder });
      return;
    }
    targets.push({ existingId: section.id });
    const current = sectionById.get(section.id)!;
    const change: SectionUpdate = { id: section.id };
    let valuesChanged = false;
    if (!sameLocalizedText(current.title, values.title)) {
      change.title = values.title;
      valuesChanged = true;
    }
    if (!sameLocalizedText(current.description, values.description)) {
      change.description = values.description;
      valuesChanged = true;
    }
    if (current.sortOrder !== sortOrder) change.sortOrder = sortOrder;
    if (valuesChanged) sectionsUpdated += 1;
    if (Object.keys(change).length > 1) sectionUpdate.push(change);
  });
  const sectionRemove = existingSections.filter((section) => !sectionIds.seen.has(section.id)).map((section) => section.id);

  // Lessons: position = index in the flattened learning order.
  const placed: { item: RequestedItem; target: SectionTarget }[] = [
    ...requested.sections.flatMap((section, index) => section.items.map((item) => ({ item, target: targets[index]! }))),
    ...requested.looseItems.map((item) => ({ item, target: null })),
  ];
  const itemCreate: ItemCreate[] = [];
  const itemUpdate: ItemUpdate[] = [];
  let itemsUpdated = 0;
  let itemsMoved = 0;
  placed.forEach(({ item, target }, sortOrder) => {
    const values: ItemValues = {
      title: item.title,
      description: item.description,
      estimatedMinutes: item.estimatedMinutes,
      isRequired: item.isRequired,
      isPublished: item.isPublished,
    };
    if (item.id === undefined) {
      itemCreate.push({ ...values, sortOrder, section: target });
      return;
    }
    const current = itemById.get(item.id)!;
    const change: ItemUpdate = { id: item.id };
    let valuesChanged = false;
    if (!sameLocalizedText(current.title, values.title)) {
      change.title = values.title;
      valuesChanged = true;
    }
    if (!sameLocalizedText(current.description, values.description)) {
      change.description = values.description;
      valuesChanged = true;
    }
    if (current.estimatedMinutes !== values.estimatedMinutes) {
      change.estimatedMinutes = values.estimatedMinutes;
      valuesChanged = true;
    }
    if (current.isRequired !== values.isRequired) {
      change.isRequired = values.isRequired;
      valuesChanged = true;
    }
    if (current.isPublished !== values.isPublished) {
      change.isPublished = values.isPublished;
      valuesChanged = true;
    }
    if (current.sortOrder !== sortOrder) change.sortOrder = sortOrder;
    if (!sameTarget(current.sectionId, target)) {
      change.section = target;
      itemsMoved += 1;
    }
    if (valuesChanged) itemsUpdated += 1;
    if (Object.keys(change).length > 1) itemUpdate.push(change);
  });
  const itemRemove = existingItems.filter((item) => !itemIds.seen.has(item.id)).map((item) => item.id);

  const sectionsBefore = [...existingSections].sort((a, b) => a.sortOrder - b.sortOrder).map((section) => section.id);
  const sectionsAfter = requested.sections.flatMap((section) => (section.id === undefined ? [] : [section.id]));
  const itemsBefore = learningOrderOf(existingSections, existingItems);
  const itemsAfter = placed.flatMap(({ item }) => (item.id === undefined ? [] : [item.id]));
  const reordered = relativeOrderChanged(sectionsBefore, sectionsAfter) || relativeOrderChanged(itemsBefore, itemsAfter);

  const changed =
    sectionCreate.length > 0 ||
    sectionUpdate.length > 0 ||
    sectionRemove.length > 0 ||
    itemCreate.length > 0 ||
    itemUpdate.length > 0 ||
    itemRemove.length > 0;
  return {
    ok: true,
    changed,
    sections: { create: sectionCreate, update: sectionUpdate, remove: sectionRemove },
    items: { create: itemCreate, update: itemUpdate, remove: itemRemove },
    counts: {
      sections: { added: sectionCreate.length, updated: sectionsUpdated, removed: sectionRemove.length },
      items: { added: itemCreate.length, updated: itemsUpdated, removed: itemRemove.length, moved: itemsMoved },
      reordered,
      totalSections: requested.sections.length,
      totalItems: placed.length,
    },
  };
}

/**
 * The stored lessons in learning order: the levels in order with their
 * lessons by position, then the lessons outside every level (or in a level
 * that no longer exists) — the order of buildCurriculum() in
 * learning.curriculum.ts.
 */
export function learningOrderOf(sections: readonly ExistingSection[], items: readonly ExistingItem[]): string[] {
  const order = [...sections].sort((a, b) => a.sortOrder - b.sortOrder).map((section) => section.id);
  const known = new Set(order);
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const grouped = order.flatMap((sectionId) => sorted.filter((item) => item.sectionId === sectionId).map((item) => item.id));
  const loose = sorted.filter((item) => item.sectionId === null || !known.has(item.sectionId)).map((item) => item.id);
  return [...grouped, ...loose];
}
