// TEST-164 (unit) — MOD-11-T05 «my invoices» rules (D-R65): which key opens
// which relation, and the receipts an owner sees.
import { describe, expect, it } from 'vitest';
import { myInvoicesAccess, myInvoicesMissing, ownerPayments } from './my-invoices.policy.js';

describe('«my invoices» rules (TEST-164)', () => {
  it('opens self with invoices.read_own and child with invoices.read_linked; neither is a 403 naming both', () => {
    expect(myInvoicesAccess(['invoices.read_own'])).toEqual({ self: true, child: false });
    expect(myInvoicesAccess(['invoices.read_linked', 'users.read'])).toEqual({ self: false, child: true });
    expect(myInvoicesMissing(['invoices.read_own'])).toBeNull();
    expect(myInvoicesMissing(['invoices.read_all', 'invoices.manage', 'payments.record'])).toEqual(['invoices.read_own', 'invoices.read_linked']);
  });

  it('keeps the completed payments only, without the recorder, the note or the reversal', () => {
    const base = { amount: 100, method: 'cash', paidAt: '2026-11-11T07:00:00.000Z', reference: null, payerName: 'ولي الأمر' };
    const seen = ownerPayments([
      { id: 'p2', number: 'RCPT-2026-00002', status: 'reversed', ...base },
      { id: 'p1', number: 'RCPT-2026-00001', status: 'completed', ...base, recordedBy: { fullName: 'x' }, notes: 'داخلي', reverseReason: null } as never,
    ]);
    expect(seen).toEqual([{ id: 'p1', number: 'RCPT-2026-00001', ...base }]);
    expect(Object.keys(seen[0]!).sort()).toEqual(['amount', 'id', 'method', 'number', 'paidAt', 'payerName', 'reference']);
  });
});
