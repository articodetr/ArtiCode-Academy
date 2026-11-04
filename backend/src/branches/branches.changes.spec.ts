// TEST-069 (unit part) — MOD-02-T06 update planning of a branch (O8): diff
// against the current row, whole-object localized texts, null clears, fixed
// field order, and the main-branch rules (a promotion; a main branch must be
// active) — pure functions, no database.
import type { CurrentBranch } from './branches.changes.js';
import { BRANCH_PATCH_FIELDS, isEmptyBranchPatch, planBranchUpdate } from './branches.changes.js';

function branch(overrides: Partial<CurrentBranch> = {}): CurrentBranch {
  return {
    code: 'NORTH',
    name: { ar: 'الفرع الشمالي', en: 'North branch' },
    address: null,
    phone: null,
    timezone: null,
    isMain: false,
    isActive: true,
    ...overrides,
  };
}

describe('branch update planning (TEST-069)', () => {
  it('detects an empty body and nothing else', () => {
    expect(isEmptyBranchPatch({})).toBe(true);
    expect(isEmptyBranchPatch({ phone: undefined })).toBe(true);
    expect(isEmptyBranchPatch({ phone: null })).toBe(false);
    expect(isEmptyBranchPatch({ isActive: false })).toBe(false);
  });

  it('writes only the changed fields, in the fixed order of BRANCH_PATCH_FIELDS', () => {
    expect(BRANCH_PATCH_FIELDS).toEqual(['code', 'name', 'address', 'phone', 'timezone', 'isMain', 'isActive']);
    const plan = planBranchUpdate(branch(), {
      isActive: false,
      timezone: 'Europe/Istanbul',
      code: 'NORTH',
      address: { ar: 'شارع الملك' },
      name: { ar: 'الفرع الشمالي', en: 'North branch' },
    });
    expect(plan.fields).toEqual(['address', 'timezone', 'isActive']);
    expect(plan.data).toEqual({ address: { ar: 'شارع الملك' }, timezone: 'Europe/Istanbul', isActive: false });
    expect(plan).toMatchObject({ promotes: false, mainInactive: null });
  });

  it('compares localized texts as whole objects and clears with null', () => {
    const current = branch({ address: { ar: 'شارع', en: 'Street' }, phone: '+966500000000' });
    expect(planBranchUpdate(current, { address: { ar: 'شارع', en: 'Street' } }).fields).toEqual([]);
    expect(planBranchUpdate(current, { address: { ar: 'شارع' } }).fields).toEqual(['address']);
    expect(planBranchUpdate(current, { name: { ar: 'الفرع الشمالي' } }).fields).toEqual(['name']);
    const cleared = planBranchUpdate(current, { address: null, phone: null, timezone: null });
    expect(cleared.fields).toEqual(['address', 'phone']);
    expect(cleared.data).toEqual({ address: null, phone: null });
  });

  it('marks a promotion, and none for a branch that is already main', () => {
    expect(planBranchUpdate(branch(), { isMain: true })).toMatchObject({ fields: ['isMain'], promotes: true, mainInactive: null });
    expect(planBranchUpdate(branch({ isMain: true }), { isMain: true })).toMatchObject({ fields: [], promotes: false });
    expect(planBranchUpdate(branch({ isMain: true }), { isMain: false })).toMatchObject({ fields: ['isMain'], promotes: false, mainInactive: null });
  });

  it('refuses a main branch that ends up inactive, naming why', () => {
    expect(planBranchUpdate(branch({ isMain: true }), { isActive: false }).mainInactive).toBe('deactivate');
    expect(planBranchUpdate(branch({ isMain: true }), { isActive: false, isMain: false }).mainInactive).toBeNull();
    expect(planBranchUpdate(branch({ isActive: false }), { isMain: true }).mainInactive).toBe('promote_inactive');
    expect(planBranchUpdate(branch({ isActive: false }), { isMain: true, isActive: true }).mainInactive).toBeNull();
    expect(planBranchUpdate(branch({ isActive: false }), { name: { ar: 'اسم آخر' } }).mainInactive).toBeNull();
  });
});
