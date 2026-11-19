// TEST-246 (unit part) — MOD-20 curriculum replacement planning (API-227,
// D-R130/D-R135) — no database.
import { learningOrderOf, planCurriculumReplacement } from './curriculum.changes.js';
import type { ExistingItem, ExistingSection, RequestedCurriculum, RequestedItem, RequestedSection } from './curriculum.changes.js';

const section = (id: string, sortOrder: number, title: string | null = null): ExistingSection => ({
  id,
  sortOrder,
  title: title === null ? null : { ar: title },
  description: null,
});
const item = (id: string, sectionId: string | null, sortOrder: number): ExistingItem => ({
  id,
  sectionId,
  sortOrder,
  title: { ar: id },
  description: null,
  estimatedMinutes: null,
  isRequired: true,
  isPublished: true,
});
const keepItem = (existing: ExistingItem, overrides: Partial<RequestedItem> = {}): RequestedItem => ({
  id: existing.id,
  title: existing.title,
  description: existing.description,
  estimatedMinutes: existing.estimatedMinutes,
  isRequired: existing.isRequired,
  isPublished: existing.isPublished,
  ...overrides,
});
const keepSection = (existing: ExistingSection, items: RequestedItem[], overrides: Partial<RequestedSection> = {}): RequestedSection => ({
  id: existing.id,
  title: existing.title,
  description: existing.description,
  items,
  ...overrides,
});
const newItem = (title: string, overrides: Partial<RequestedItem> = {}): RequestedItem => ({
  title: { ar: title },
  description: null,
  estimatedMinutes: null,
  isRequired: true,
  isPublished: true,
  ...overrides,
});

// Stored: level s1 (a, b), level s2 (c), loose d.
const s1 = section('s1', 0, 'أساسيات');
const s2 = section('s2', 1);
const a = item('a', 's1', 0);
const b = item('b', 's1', 1);
const c = item('c', 's2', 2);
const d = item('d', null, 3);
const stored = { sections: [s1, s2], items: [a, b, c, d] };
const same = (): RequestedCurriculum => ({ sections: [keepSection(s1, [keepItem(a), keepItem(b)]), keepSection(s2, [keepItem(c)])], looseItems: [keepItem(d)] });

function planOf(requested: RequestedCurriculum) {
  const plan = planCurriculumReplacement(stored.sections, stored.items, requested);
  if (!plan.ok) throw new Error('expected ok');
  return plan;
}

describe('curriculum replacement planning', () => {
  it('writes nothing for the stored structure, and nothing for two empty curricula', () => {
    const plan = planOf(same());
    expect(plan.changed).toBe(false);
    expect(plan.sections).toEqual({ create: [], update: [], remove: [] });
    expect(plan.items).toEqual({ create: [], update: [], remove: [] });
    expect(plan.counts).toEqual({
      sections: { added: 0, updated: 0, removed: 0 },
      items: { added: 0, updated: 0, removed: 0, moved: 0 },
      reordered: false,
      totalSections: 2,
      totalItems: 4,
    });
    expect(planCurriculumReplacement([], [], { sections: [], looseItems: [] })).toMatchObject({ ok: true, changed: false });
  });

  it('creates levels and lessons: a new lesson points at its new level by index, positions follow the flattened order', () => {
    const plan = planOf({
      sections: [keepSection(s1, [keepItem(a), keepItem(b)]), keepSection(s2, [keepItem(c)]), { title: { ar: 'جديد' }, description: null, items: [newItem('e'), keepItem(d)] }],
      looseItems: [newItem('f', { isRequired: false })],
    });
    expect(plan.changed).toBe(true);
    expect(plan.sections.create).toEqual([{ title: { ar: 'جديد' }, description: null, sortOrder: 2 }]);
    expect(plan.items.create).toEqual([
      { ...newItem('e'), sortOrder: 3, section: { createIndex: 0 } },
      { ...newItem('f', { isRequired: false }), sortOrder: 5, section: null },
    ]);
    // d moves into the new level and one position down.
    expect(plan.items.update).toEqual([{ id: 'd', sortOrder: 4, section: { createIndex: 0 } }]);
    expect(plan.counts).toEqual({
      sections: { added: 1, updated: 0, removed: 0 },
      items: { added: 2, updated: 0, removed: 0, moved: 1 },
      reordered: false,
      totalSections: 3,
      totalItems: 6,
    });
  });

  it('swaps two levels: positions swap, the lessons follow their level, the order counts as reordered', () => {
    const plan = planOf({ sections: [keepSection(s2, [keepItem(c)]), keepSection(s1, [keepItem(a), keepItem(b)])], looseItems: [keepItem(d)] });
    expect(plan.sections.update).toEqual([
      { id: 's2', sortOrder: 0 },
      { id: 's1', sortOrder: 1 },
    ]);
    expect(plan.items.update).toEqual([
      { id: 'c', sortOrder: 0 },
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
    ]);
    expect(plan.counts).toMatchObject({ sections: { added: 0, updated: 0, removed: 0 }, items: { updated: 0, moved: 0 }, reordered: true });
  });

  it('moves a lesson between levels and out of every level; values and moves are counted apart', () => {
    const plan = planOf({
      sections: [keepSection(s1, [keepItem(a)]), keepSection(s2, [keepItem(b, { isPublished: false }), keepItem(c)])],
      looseItems: [keepItem(d, { estimatedMinutes: 30 })],
    });
    expect(plan.items.update).toEqual([
      { id: 'b', isPublished: false, section: { existingId: 's2' } },
      { id: 'd', estimatedMinutes: 30 },
    ]);
    expect(plan.counts.items).toEqual({ added: 0, updated: 2, removed: 0, moved: 1 });
    expect(plan.counts.reordered).toBe(false);

    const out = planOf({ sections: [keepSection(s1, [keepItem(a), keepItem(b)]), keepSection(s2, [])], looseItems: [keepItem(c), keepItem(d)] });
    expect(out.items.update).toEqual([{ id: 'c', section: null }]);
    expect(out.counts.items.moved).toBe(1);
  });

  it('deletes unlisted levels and lessons; a lesson of a deleted level may be kept elsewhere', () => {
    const plan = planOf({ sections: [keepSection(s1, [keepItem(a), keepItem(c)])], looseItems: [] });
    expect(plan.sections.remove).toEqual(['s2']);
    expect(plan.items.remove).toEqual(['b', 'd']);
    expect(plan.items.update).toEqual([{ id: 'c', sortOrder: 1, section: { existingId: 's1' } }]);
    expect(plan.counts).toEqual({
      sections: { added: 0, updated: 0, removed: 1 },
      items: { added: 0, updated: 0, removed: 2, moved: 1 },
      reordered: false,
      totalSections: 1,
      totalItems: 2,
    });
    expect(planOf({ sections: [], looseItems: [] })).toMatchObject({ sections: { remove: ['s1', 's2'] }, items: { remove: ['a', 'b', 'c', 'd'] } });
  });

  it('updates a level title and clears it; whole localized objects are compared', () => {
    const plan = planOf({
      sections: [keepSection(s1, [keepItem(a), keepItem(b)], { title: null, description: { ar: 'وصف' } }), keepSection(s2, [keepItem(c)], { title: { ar: 'م2', en: 'L2' } })],
      looseItems: [keepItem(d, { title: { ar: 'd', en: 'D' } })],
    });
    expect(plan.sections.update).toEqual([
      { id: 's1', title: null, description: { ar: 'وصف' } },
      { id: 's2', title: { ar: 'م2', en: 'L2' } },
    ]);
    expect(plan.items.update).toEqual([{ id: 'd', title: { ar: 'd', en: 'D' } }]);
    expect(plan.counts).toMatchObject({ sections: { updated: 2 }, items: { updated: 1, moved: 0 } });
  });

  it('a relative order change of the kept lessons inside a level counts as reordered', () => {
    const plan = planOf({ sections: [keepSection(s1, [keepItem(b), keepItem(a)]), keepSection(s2, [keepItem(c)])], looseItems: [keepItem(d)] });
    expect(plan.items.update).toEqual([
      { id: 'b', sortOrder: 0 },
      { id: 'a', sortOrder: 1 },
    ]);
    expect(plan.counts.reordered).toBe(true);
  });

  it('refuses unknown and repeated level and lesson ids, all reported at once', () => {
    const result = planCurriculumReplacement(stored.sections, stored.items, {
      sections: [keepSection(s1, [keepItem(a), keepItem(a)]), keepSection(s1, []), { id: 'zz', title: null, description: null, items: [{ ...newItem('x'), id: 'yy' }] }],
      looseItems: [keepItem(d), keepItem(d)],
    });
    expect(result).toEqual({ ok: false, unknownSections: ['zz'], duplicateSections: ['s1'], unknownItems: ['yy'], duplicateItems: ['a', 'd'] });
  });

  it('learningOrderOf: levels in order with their lessons by position, then the loose lessons and those of a missing level', () => {
    const shuffled = [item('x', 's2', 0), item('y', 's1', 1), item('z', null, 2), item('w', 'gone', 3), item('v', 's1', 4)];
    expect(learningOrderOf([s2, s1].map((s, i) => ({ ...s, sortOrder: 1 - i })), shuffled)).toEqual(['y', 'v', 'x', 'z', 'w']);
  });
});
