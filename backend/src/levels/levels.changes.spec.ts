// TEST-040 (unit part) — MOD-04-T02 pure rules: level PATCH planning, the
// reorder permutation check, code normalisation and the shared localized-text
// helpers — no database.
import { readLocalizedText, sameLocalizedText } from '../authorization/localized-text.js';
import { COURSE_CODE_PATTERN, LEVEL_CODE_PATTERN, normalizeCode } from '../courses/courses.validation.js';
import type { CurrentLevel } from './levels.changes.js';
import { checkLevelOrder, isEmptyLevelPatch, planLevelUpdate } from './levels.changes.js';

const level = (overrides: Partial<CurrentLevel> = {}): CurrentLevel => ({
  code: 'BEG',
  name: { ar: 'مبتدئ', en: 'Beginner' },
  description: null,
  isActive: true,
  ...overrides,
});

describe('level update planning', () => {
  it('detects an empty body and nothing else', () => {
    expect(isEmptyLevelPatch({})).toBe(true);
    expect(isEmptyLevelPatch({ code: undefined })).toBe(true);
    expect(isEmptyLevelPatch({ description: null })).toBe(false);
    expect(isEmptyLevelPatch({ isActive: false })).toBe(false);
  });

  it('writes only what changes, in the fixed field order', () => {
    const plan = planLevelUpdate(level(), {
      isActive: false,
      name: { ar: 'مبتدئ', en: 'Starter' },
      code: 'BEG',
      description: { ar: 'وصف' },
    });
    expect(plan.fields).toEqual(['name', 'description', 'isActive']);
    expect(plan.data).toEqual({ name: { ar: 'مبتدئ', en: 'Starter' }, description: { ar: 'وصف' }, isActive: false });
  });

  it('is idempotent: equal values (a dropped locale counts as a change) write nothing', () => {
    expect(planLevelUpdate(level(), { code: 'BEG', name: { ar: 'مبتدئ', en: 'Beginner' }, isActive: true, description: null }).fields).toEqual([]);
    expect(planLevelUpdate(level(), { name: { ar: 'مبتدئ' } }).fields).toEqual(['name']);
  });

  it('clears a description with null and ignores null on an already empty one', () => {
    expect(planLevelUpdate(level({ description: { ar: 'قديم' } }), { description: null })).toEqual({ data: { description: null }, fields: ['description'] });
    expect(planLevelUpdate(level(), { description: null }).fields).toEqual([]);
  });
});

describe('level order check', () => {
  const ids = ['a', 'b', 'c'];

  it('accepts an exact permutation and tells whether it changes anything', () => {
    expect(checkLevelOrder(ids, ['a', 'b', 'c'])).toEqual({ ok: true, changed: false });
    expect(checkLevelOrder(ids, ['c', 'a', 'b'])).toEqual({ ok: true, changed: true });
    expect(checkLevelOrder([], [])).toEqual({ ok: true, changed: false });
  });

  it('reports missing, unknown and duplicate ids together', () => {
    expect(checkLevelOrder(ids, ['a', 'a', 'x'])).toEqual({
      ok: false,
      problems: { missing: ['b', 'c'], unknown: ['x'], duplicates: ['a'] },
    });
    expect(checkLevelOrder(ids, ['a', 'b'])).toEqual({ ok: false, problems: { missing: ['c'], unknown: [], duplicates: [] } });
  });
});

describe('MOD-04 codes and localized text', () => {
  it('normalises codes to trimmed upper case and treats blanks as absent', () => {
    expect(normalizeCode('  py-101 ')).toBe('PY-101');
    expect(normalizeCode('   ')).toBeUndefined();
    expect(normalizeCode(null)).toBeUndefined();
    expect(normalizeCode(42)).toBe(42);
  });

  it('accepts the documented alphabets and lengths', () => {
    expect(LEVEL_CODE_PATTERN.test('BEG')).toBe(true);
    expect(LEVEL_CODE_PATTERN.test('A'.repeat(16))).toBe(true);
    expect(LEVEL_CODE_PATTERN.test('A'.repeat(17))).toBe(false);
    expect(LEVEL_CODE_PATTERN.test('-BEG')).toBe(false);
    expect(LEVEL_CODE_PATTERN.test('BE G')).toBe(false);
    expect(COURSE_CODE_PATTERN.test('PY-101.A_2')).toBe(true);
    expect(COURSE_CODE_PATTERN.test('A'.repeat(33))).toBe(false);
  });

  it('compares and reads localized jsonb safely', () => {
    expect(sameLocalizedText(null, null)).toBe(true);
    expect(sameLocalizedText(null, { ar: 'أ' })).toBe(false);
    expect(sameLocalizedText({ ar: 'أ', en: undefined }, { ar: 'أ' })).toBe(true);
    expect(readLocalizedText({ ar: 'أ', en: 'A', xx: 'ignored', tr: 7 })).toEqual({ ar: 'أ', en: 'A' });
    expect(readLocalizedText({ en: 'no ar' })).toBeNull();
    expect(readLocalizedText(['ar'])).toBeNull();
    expect(readLocalizedText(null)).toBeNull();
  });
});
