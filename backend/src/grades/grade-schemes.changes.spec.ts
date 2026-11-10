// TEST-128 (unit) — the band rules and the smallest update of a grade scheme (MOD-09-T02, D-R46).
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRADE_SCHEME_BANDS } from './grade-schemes.defaults.js';
import { bandOf, checkBands, percentText, planGradeSchemeUpdate, sameBands } from './grade-schemes.changes.js';
import type { CurrentScheme, SchemeBand } from './grade-schemes.changes.js';

const band = (min: number, isPass: boolean, ar = `≥${min}`, letter: string | null = null): SchemeBand => ({ minPercent: percentText(min), label: { ar }, letter, isPass });
const DEFAULT: SchemeBand[] = DEFAULT_GRADE_SCHEME_BANDS.map((b) => ({ minPercent: percentText(b.minPercent), label: b.label, letter: b.letter, isPass: b.isPass }));

describe('checkBands', () => {
  it('accepts the default scheme and any order of valid bands', () => {
    expect(checkBands(DEFAULT)).toEqual({ problems: [], duplicates: [] });
    expect(checkBands([band(60, true), band(0, false)])).toEqual({ problems: [], duplicates: [] });
    expect(checkBands([band(0, true), band(50, true)])).toEqual({ problems: [], duplicates: [] }); // everyone passes
  });

  it('needs a band at 0, distinct minimums, a passing band and passing bands only above the first one', () => {
    expect(checkBands([band(10, false), band(60, true)]).problems).toEqual(['no_zero_band']);
    expect(checkBands([band(0, false), band(60, true), band(60, true)])).toEqual({ problems: ['duplicate_min_percent'], duplicates: [60] });
    expect(checkBands([band(0, false), band(50, false)]).problems).toEqual(['no_passing_band']);
    expect(checkBands([band(0, false), band(50, true), band(80, false)]).problems).toEqual(['pass_not_ascending']);
    expect(checkBands([band(5, false), band(5, false)]).problems).toEqual(['no_zero_band', 'duplicate_min_percent', 'no_passing_band']);
  });
});

describe('bandOf', () => {
  it('takes the highest minimum that does not exceed the percentage', () => {
    expect(bandOf(DEFAULT, 0)!.label.ar).toBe('راسب');
    expect(bandOf(DEFAULT, 59.99)!.label.ar).toBe('راسب');
    expect(bandOf(DEFAULT, 60)!.label.ar).toBe('مقبول');
    expect(bandOf(DEFAULT, 89.99)!.label.ar).toBe('جيد جداً');
    expect(bandOf(DEFAULT, 100)!.label.ar).toBe('ممتاز');
    expect(bandOf([band(10, true)], 5)).toBeNull();
  });
});

describe('planGradeSchemeUpdate', () => {
  const scheme = (over: Partial<CurrentScheme> = {}): CurrentScheme => ({ name: { ar: 'سلّم' }, isDefault: false, isActive: true, bands: [band(0, false), band(60, true)], ...over });

  it('writes nothing for the same values, bands compared in canonical order', () => {
    expect(planGradeSchemeUpdate(scheme(), { name: { ar: 'سلّم' }, bands: [band(60, true), band(0, false)], isActive: true })).toEqual({ fields: [], promotes: false });
    expect(sameBands([band(0, false), band(60, true, 'ناجح', 'P')], [band(0, false), band(60, true, 'ناجح', null)])).toBe(false);
  });

  it('plans the changed fields, the bands sorted, and a promotion', () => {
    const plan = planGradeSchemeUpdate(scheme(), { name: { ar: 'جديد', en: 'New' }, bands: [band(70, true), band(0, false)], isDefault: true });
    expect(plan.fields).toEqual(['name', 'bands', 'isDefault']);
    expect(plan.promotes).toBe(true);
    expect(plan.bands!.map((b) => b.minPercent)).toEqual(['0.00', '70.00']);
    expect(planGradeSchemeUpdate(scheme({ isDefault: true }), { isDefault: true })).toEqual({ fields: [], promotes: false }); // already the default
    expect(planGradeSchemeUpdate(scheme(), { isDefault: false })).toEqual({ fields: [], promotes: false }); // not the default: nothing to do
    expect(planGradeSchemeUpdate(scheme({ isActive: false }), { isActive: true })).toMatchObject({ fields: ['isActive'], isActive: true });
    expect(planGradeSchemeUpdate(scheme({ isActive: false }), { isDefault: true, isActive: true })).toMatchObject({ fields: ['isDefault', 'isActive'], promotes: true });
  });

  it('keeps one active default: refuses unsetting, deactivating it and promoting an inactive scheme', () => {
    expect(planGradeSchemeUpdate(scheme({ isDefault: true }), { isDefault: false }).refusal).toBe('unset_default');
    expect(planGradeSchemeUpdate(scheme({ isDefault: true }), { isActive: false }).refusal).toBe('deactivate');
    expect(planGradeSchemeUpdate(scheme({ isActive: false }), { isDefault: true }).refusal).toBe('promote_inactive');
    expect(planGradeSchemeUpdate(scheme(), { isDefault: true, isActive: false }).refusal).toBe('promote_inactive');
  });
});
