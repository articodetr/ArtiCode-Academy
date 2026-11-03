// TEST-048 (unit) — planning of a class PATCH (MOD-05-T02).
import { describe, expect, it } from 'vitest';
import { invalidDateRange, isEmptyClassPatch, planClassUpdate } from './classes.changes.js';
import type { ClassValues } from './classes.changes.js';

const CURRENT: ClassValues = {
  code: 'PY-101-A',
  name: { ar: 'فصل أ', en: 'Class A' },
  capacity: 20,
  startsOn: '2026-11-10',
  endsOn: '2026-12-20',
  notes: null,
};

describe('planClassUpdate', () => {
  it('keeps only the fields whose value changes, in catalogue order', () => {
    const plan = planClassUpdate(CURRENT, { notes: 'Room 4', capacity: 20, name: { ar: 'فصل أ', en: 'Class A' }, endsOn: '2026-12-31' });
    expect(plan.fields).toEqual(['endsOn', 'notes']);
    expect(plan.data).toEqual({ endsOn: '2026-12-31', notes: 'Room 4' });
  });

  it('treats null as a change only when a value is stored, and compares localized names locale by locale', () => {
    expect(planClassUpdate(CURRENT, { notes: null }).fields).toEqual([]);
    expect(planClassUpdate(CURRENT, { startsOn: null }).data).toEqual({ startsOn: null });
    expect(planClassUpdate(CURRENT, { name: { ar: 'فصل أ' } }).fields).toEqual(['name']);
    expect(planClassUpdate(CURRENT, { code: 'PY-101-A', capacity: 21 }).fields).toEqual(['capacity']);
  });

  it('recognises an empty body', () => {
    expect(isEmptyClassPatch({})).toBe(true);
    expect(isEmptyClassPatch({ notes: null })).toBe(false);
  });
});

describe('invalidDateRange', () => {
  it('checks the merged range and accepts open ends', () => {
    expect(invalidDateRange(CURRENT, { endsOn: '2026-11-09' })).toEqual({ startsOn: '2026-11-10', endsOn: '2026-11-09' });
    expect(invalidDateRange(CURRENT, { startsOn: '2026-12-21' })).toEqual({ startsOn: '2026-12-21', endsOn: '2026-12-20' });
    expect(invalidDateRange(CURRENT, { endsOn: '2026-11-10' })).toBeNull();
    expect(invalidDateRange(CURRENT, { startsOn: null, endsOn: '2020-01-01' })).toBeNull();
    expect(invalidDateRange({ startsOn: null, endsOn: null }, {})).toBeNull();
  });
});
