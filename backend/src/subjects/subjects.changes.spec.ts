// PORTAL-04 (unit part) — the subjects' pure rules: PATCH planning and the
// reorder permutation check — no database (a mirror of levels.changes.spec.ts).
import { describe, expect, it } from 'vitest';
import { LEVEL_CODE_PATTERN, normalizeCode } from '../courses/courses.validation.js';
import type { CurrentSubject } from './subjects.changes.js';
import { checkSubjectOrder, isEmptySubjectPatch, planSubjectUpdate } from './subjects.changes.js';

const subject = (overrides: Partial<CurrentSubject> = {}): CurrentSubject => ({
  code: 'MATH',
  name: { ar: 'الرياضيات', en: 'Mathematics' },
  isActive: true,
  ...overrides,
});

describe('subject update planning', () => {
  it('detects an empty body and nothing else', () => {
    expect(isEmptySubjectPatch({})).toBe(true);
    expect(isEmptySubjectPatch({ code: undefined })).toBe(true);
    expect(isEmptySubjectPatch({ isActive: false })).toBe(false);
    expect(isEmptySubjectPatch({ name: { ar: 'م' } })).toBe(false);
  });

  it('writes only what changes, in the fixed field order', () => {
    const plan = planSubjectUpdate(subject(), { isActive: false, name: { ar: 'الرياضيات', en: 'Maths' }, code: 'MATH' });
    expect(plan.fields).toEqual(['name', 'isActive']);
    expect(plan.data).toEqual({ name: { ar: 'الرياضيات', en: 'Maths' }, isActive: false });
    expect(planSubjectUpdate(subject(), { code: 'MATHS' })).toEqual({ data: { code: 'MATHS' }, fields: ['code'] });
  });

  it('is idempotent: equal values write nothing, a dropped locale counts as a change', () => {
    expect(planSubjectUpdate(subject(), { code: 'MATH', name: { ar: 'الرياضيات', en: 'Mathematics' }, isActive: true }).fields).toEqual([]);
    expect(planSubjectUpdate(subject(), { name: { ar: 'الرياضيات' } }).fields).toEqual(['name']);
  });
});

describe('subject order check', () => {
  const ids = ['a', 'b', 'c'];

  it('accepts an exact permutation and tells whether it changes anything', () => {
    expect(checkSubjectOrder(ids, ['a', 'b', 'c'])).toEqual({ ok: true, changed: false });
    expect(checkSubjectOrder(ids, ['b', 'c', 'a'])).toEqual({ ok: true, changed: true });
    expect(checkSubjectOrder([], [])).toEqual({ ok: true, changed: false });
  });

  it('reports missing, unknown and duplicate ids together', () => {
    expect(checkSubjectOrder(ids, ['c', 'c', 'x', 'x'])).toEqual({
      ok: false,
      problems: { missing: ['a', 'b'], unknown: ['x'], duplicates: ['c', 'x'] },
    });
    expect(checkSubjectOrder(ids, ['a', 'b'])).toEqual({ ok: false, problems: { missing: ['c'], unknown: [], duplicates: [] } });
  });

  it('shares the level code rule: trimmed, upper-cased, 1–16 characters', () => {
    expect(normalizeCode(' math-1 ')).toBe('MATH-1');
    expect(LEVEL_CODE_PATTERN.test('PHYSICS')).toBe(true);
    expect(LEVEL_CODE_PATTERN.test('A'.repeat(17))).toBe(false);
  });
});
