// TEST-042 (unit part) — MOD-04-T04 syllabus replacement planning — no database.
import type { ExistingSyllabusItem, RequestedSyllabusItem } from './syllabus.changes.js';
import { planSyllabusReplacement } from './syllabus.changes.js';

const item = (id: string, sortOrder: number, title = id): ExistingSyllabusItem => ({
  id,
  sortOrder,
  title: { ar: title },
  description: null,
  estimatedMinutes: null,
});
const keep = (existing: ExistingSyllabusItem, overrides: Partial<RequestedSyllabusItem> = {}): RequestedSyllabusItem => ({
  id: existing.id,
  title: existing.title,
  description: existing.description,
  estimatedMinutes: existing.estimatedMinutes,
  ...overrides,
});

const a = item('a', 0);
const b = item('b', 1);
const c = item('c', 2);

describe('syllabus replacement planning', () => {
  it('writes nothing for the stored syllabus, and nothing for two empty lists', () => {
    const plan = planSyllabusReplacement([a, b, c], [keep(a), keep(b), keep(c)]);
    expect(plan).toMatchObject({ ok: true, changed: false, create: [], update: [], remove: [] });
    expect(planSyllabusReplacement([], [])).toMatchObject({ ok: true, changed: false });
  });

  it('creates new items at their index, deletes unlisted ones and moves the kept ones', () => {
    const plan = planSyllabusReplacement([a, b, c], [keep(c), { title: { ar: 'جديد' }, description: null, estimatedMinutes: 30 }, keep(a)]);
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.create).toEqual([{ title: { ar: 'جديد' }, description: null, estimatedMinutes: 30, sortOrder: 1 }]);
    expect(plan.remove).toEqual(['b']);
    expect(plan.update).toEqual([
      { id: 'c', sortOrder: 0 },
      { id: 'a', sortOrder: 2 },
    ]);
    expect(plan.counts).toEqual({ added: 1, updated: 0, removed: 1, reordered: true });
    expect(plan.changed).toBe(true);
  });

  it('counts content changes apart from moves and keeps relative order after a removal', () => {
    const plan = planSyllabusReplacement([a, b, c], [keep(b, { estimatedMinutes: 45, description: { ar: 'وصف' } }), keep(c)]);
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.update).toEqual([
      { id: 'b', sortOrder: 0, description: { ar: 'وصف' }, estimatedMinutes: 45 },
      { id: 'c', sortOrder: 1 },
    ]);
    expect(plan.counts).toEqual({ added: 0, updated: 1, removed: 1, reordered: false });
  });

  it('compares titles as whole localized objects', () => {
    const plan = planSyllabusReplacement([a], [keep(a, { title: { ar: 'a', en: 'A' } })]);
    expect(plan).toMatchObject({ ok: true, changed: true, update: [{ id: 'a', title: { ar: 'a', en: 'A' } }] });
  });

  it('refuses ids of other courses and repeated ids', () => {
    expect(planSyllabusReplacement([a, b], [keep(a), { id: 'zzz', title: { ar: 'x' }, description: null, estimatedMinutes: null }, keep(a)])).toEqual({
      ok: false,
      unknown: ['zzz'],
      duplicates: ['a'],
    });
  });

  it('clears everything with an empty list', () => {
    const plan = planSyllabusReplacement([a, b], []);
    expect(plan).toMatchObject({ ok: true, changed: true, remove: ['a', 'b'], counts: { added: 0, updated: 0, removed: 2, reordered: false } });
  });
});
