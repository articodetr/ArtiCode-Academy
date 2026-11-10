// TEST-162 (unit) — MOD-11-T03 invoice rules (D-R60..D-R62, D-R64): the draft
// checks, the FIFO allocation of the paid amount with overdue parts, the
// payment state, the status actions, the numbers, the plan scope and the
// smallest PATCH.
import { describe, expect, it } from 'vitest';
import { canonical, splitInstallments } from './fee-plans.rules.js';
import {
  allocate,
  allowedInvoiceActions,
  balanceOf,
  changedInvoiceFields,
  checkInvoice,
  dayIn,
  formatNumber,
  invoiceTotals,
  nextDueOf,
  nextInvoiceStatus,
  paymentStateOf,
  planFits,
} from './invoices.calc.js';
import type { InvoiceContent } from './invoices.calc.js';

const lines = [{ amount: '1000.00' }, { amount: '500.00' }];
const parts = [
  { amount: '700.00', dueOn: '2026-11-01' },
  { amount: '700.00', dueOn: '2026-12-01' },
];

describe('invoice rules (TEST-162)', () => {
  it('checks a draft: lines, a discount within the subtotal with its reason, installments summing to the total in order', () => {
    expect(invoiceTotals({ lines, discountAmount: '100.00' })).toEqual({ subtotal: '1500.00', total: '1400.00' });
    expect(checkInvoice({ lines, installments: parts, discountAmount: '100.00', discountReason: 'منحة' })).toEqual([]);
    expect(checkInvoice({ lines: [], installments: [], discountAmount: 0, discountReason: null })).toEqual(['no_lines', 'total_zero', 'no_installments']);
    expect(checkInvoice({ lines, installments: parts, discountAmount: '1600.00', discountReason: null })).toEqual([
      'discount_exceeds_subtotal',
      'total_zero',
      'installments_sum',
    ]);
    expect(checkInvoice({ lines, installments: [...parts].reverse(), discountAmount: 0, discountReason: 'سبب' })).toEqual([
      'discount_reason_without_discount',
      'installments_sum',
      'due_dates_not_ascending',
    ]);
    // A tiny total split by shares can round into a zero part — refused before any write.
    const tiny = splitInstallments('0.01', [{ percent: 50, dueOffsetDays: 0 }, { percent: 50, dueOffsetDays: 1 }], '2026-11-11');
    expect(checkInvoice({ lines: [{ amount: '0.01' }], installments: tiny, discountAmount: 0, discountReason: null })).toEqual(['installment_not_positive']);
  });

  it('allocates the paid amount to the oldest installments first; overdue = due before today and not covered', () => {
    const stored = [
      { seq: 2, amount: '700.00', dueOn: '2026-12-01' },
      { seq: 1, amount: '700.00', dueOn: '2026-11-01' },
    ];
    const allocated = allocate(stored, '900.00', '2026-11-11');
    expect(allocated).toEqual([
      { seq: 1, amount: '700.00', dueOn: '2026-11-01', paid: '700.00', remaining: '0.00', status: 'paid', overdue: false },
      { seq: 2, amount: '700.00', dueOn: '2026-12-01', paid: '200.00', remaining: '500.00', status: 'partial', overdue: false },
    ]);
    expect(nextDueOf(allocated)).toEqual({ seq: 2, dueOn: '2026-12-01', remaining: '500.00' });
    const late = allocate(stored, '0.00', '2026-11-11');
    expect(late.map((part) => [part.status, part.overdue])).toEqual([
      ['unpaid', true],
      ['unpaid', false],
    ]);
    // Due today is not yet overdue.
    expect(allocate(stored, '0', '2026-11-01')[0]!.overdue).toBe(false);
    expect(nextDueOf(allocate(stored, '1400', '2027-01-01'))).toBeNull();
    expect([paymentStateOf('1400.00', '0.00'), paymentStateOf('1400.00', '900.00'), paymentStateOf('1400.00', '1400.00')]).toEqual(['unpaid', 'partial', 'paid']);
    expect(balanceOf('1400.00', '900.10')).toBe('499.90');
  });

  it('issues a draft and cancels an issued invoice only', () => {
    expect(nextInvoiceStatus('issue', 'draft')).toBe('issued');
    expect(nextInvoiceStatus('issue', 'issued')).toBeNull();
    expect(nextInvoiceStatus('cancel', 'issued')).toBe('cancelled');
    expect(nextInvoiceStatus('cancel', 'draft')).toBeNull();
    expect([allowedInvoiceActions('draft'), allowedInvoiceActions('issued'), allowedInvoiceActions('cancelled')]).toEqual([['issue'], ['cancel'], []]);
  });

  it('formats numbers, days in the academy zone and the plan scope', () => {
    expect(formatNumber('INV', '2026', 7)).toBe('INV-2026-00007');
    expect(formatNumber('RCPT', '2027', 123456)).toBe('RCPT-2027-123456');
    // 2026-12-31 22:30 UTC is already 2027-01-01 in Istanbul (UTC+3).
    expect(dayIn('Europe/Istanbul', new Date('2026-12-31T22:30:00Z'))).toBe('2027-01-01');
    expect(dayIn('Not/AZone', new Date('2026-12-31T22:30:00Z'))).toBe('2026-12-31');
    const target = { classId: 'k1', courseId: 'c1' };
    expect([
      planFits({ courseId: null, classId: null }, target),
      planFits({ courseId: 'c1', classId: null }, target),
      planFits({ courseId: null, classId: 'k1' }, target),
      planFits({ courseId: 'c2', classId: null }, target),
      planFits({ courseId: null, classId: 'k2' }, target),
    ]).toEqual([true, true, true, false, false]);
  });

  it('plans the smallest PATCH: amounts by value, descriptions by content, lines and installments whole', () => {
    const current: InvoiceContent = {
      enrollmentId: null,
      lines: [{ description: { ar: 'رسوم', en: 'Fee' }, amount: '1500.00' }],
      installments: [{ amount: '1500.00', dueOn: '2026-12-01' }],
      discountAmount: '0.00',
      discountReason: null,
      notes: null,
    };
    const same: InvoiceContent = { ...current, lines: [{ description: { en: 'Fee', ar: 'رسوم' }, amount: '1500' }], installments: [{ amount: '1500.0', dueOn: '2026-12-01' }], discountAmount: '0' };
    expect(changedInvoiceFields(current, same, canonical)).toEqual([]);
    const next: InvoiceContent = {
      enrollmentId: 'e1',
      lines: [{ description: { ar: 'رسوم' }, amount: '1500.00' }],
      installments: [{ amount: '1500.00', dueOn: '2026-12-02' }],
      discountAmount: '0.00',
      discountReason: null,
      notes: 'ملاحظة',
    };
    expect(changedInvoiceFields(current, next, canonical)).toEqual(['enrollmentId', 'lines', 'installments', 'notes']);
  });
});
