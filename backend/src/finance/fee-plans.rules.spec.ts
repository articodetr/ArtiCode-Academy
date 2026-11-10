// TEST-161 (unit) — MOD-11-T02 fee plan rules (D-R60/D-R62/D-R65): the plan
// checks, the installment split (half-up cents, remainder on the last), day
// arithmetic, the smallest update and the either-key reading rule.
import { describe, expect, it } from 'vitest';
import { addDays, checkPlan, linesTotal, planFeePlanUpdate, splitInstallments } from './fee-plans.rules.js';
import { FEE_PLAN_READ_PERMISSIONS, INVOICE_READ_PERMISSIONS, missingAny } from './finance.policy.js';

describe('fee plan rules (TEST-161)', () => {
  it('accepts shares summing to exactly 100 with non-decreasing offsets, a course or a class', () => {
    const shares = [
      { percent: 33.33, dueOffsetDays: 0 },
      { percent: 33.33, dueOffsetDays: 30 },
      { percent: 33.34, dueOffsetDays: 30 },
    ];
    expect(checkPlan({ courseId: 'c', classId: null, installments: shares })).toEqual([]);
    expect(checkPlan({ courseId: 'c', classId: 'k', installments: [{ percent: 99.99, dueOffsetDays: 10 }, { percent: 0.01, dueOffsetDays: 5 }] })).toEqual([
      'course_and_class',
      'offsets_not_ascending',
    ]);
    expect(checkPlan({ courseId: null, classId: null, installments: [{ percent: 50, dueOffsetDays: 0 }] })).toEqual(['percent_sum']);
  });

  it('splits a total over the shares in cents, the remainder on the last, from the start day', () => {
    expect(splitInstallments('1000.00', [{ percent: 33.33, dueOffsetDays: 0 }, { percent: 33.33, dueOffsetDays: 31 }, { percent: 33.34, dueOffsetDays: 59 }], '2026-11-30')).toEqual([
      { seq: 1, amount: '333.30', dueOn: '2026-11-30' },
      { seq: 2, amount: '333.30', dueOn: '2026-12-31' },
      { seq: 3, amount: '333.40', dueOn: '2027-01-28' },
    ]);
    // Half-up: 100 × 12.345% would be 12.345 → but shares hold two decimals; 0.05 × 50% = 0.025 → 0.03, the last takes 0.02.
    expect(splitInstallments('0.05', [{ percent: 50, dueOffsetDays: 0 }, { percent: 50, dueOffsetDays: 1 }], '2026-02-28').map((part) => [part.amount, part.dueOn])).toEqual([
      ['0.03', '2026-02-28'],
      ['0.02', '2026-03-01'],
    ]);
    expect(splitInstallments('2500.00', [{ percent: 100, dueOffsetDays: 0 }], '2026-01-01')).toEqual([{ seq: 1, amount: '2500.00', dueOn: '2026-01-01' }]);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(linesTotal([{ amount: 0.1 }, { amount: 0.2 }, { amount: 1499.7 }])).toBe('1500.00');
  });

  it('plans the smallest update in the audit order', () => {
    const current = { name: { ar: 'خطة' }, courseId: 'c', classId: null, lines: [{ description: { ar: 'رسوم' }, amount: 100 }], installments: [{ percent: 100, dueOffsetDays: 0 }], isActive: true };
    expect(planFeePlanUpdate(current, { name: { ar: 'خطة' }, lines: [{ description: { ar: 'رسوم' }, amount: 100 }], isActive: true }).fields).toEqual([]);
    const changed = planFeePlanUpdate(current, { isActive: false, courseId: null, classId: 'k', name: { ar: 'خطة ٢' }, installments: [{ percent: 100, dueOffsetDays: 7 }] });
    expect(changed.fields).toEqual(['name', 'courseId', 'classId', 'installments', 'isActive']);
    expect(changed.next).toMatchObject({ courseId: null, classId: 'k', isActive: false });
  });

  it('opens plans with fee_plans.manage or invoices.manage, and invoices with read_all, invoices.manage or payments.record', () => {
    expect(missingAny(['invoices.manage'], FEE_PLAN_READ_PERMISSIONS)).toBeNull();
    expect(missingAny(['payments.record'], FEE_PLAN_READ_PERMISSIONS)).toEqual(['fee_plans.manage', 'invoices.manage']);
    expect(missingAny(['payments.record'], INVOICE_READ_PERMISSIONS)).toBeNull();
    expect(missingAny(['invoices.read_own'], INVOICE_READ_PERMISSIONS)).toEqual(['invoices.read_all', 'invoices.manage', 'payments.record']);
  });
});
