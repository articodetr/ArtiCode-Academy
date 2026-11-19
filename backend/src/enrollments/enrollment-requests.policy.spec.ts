// TEST-242 (unit) — the rules of an enrollment request (MOD-19, D-R121/D-R125):
// the payment state over the issued invoices, the request state, and what an
// existing (class, student) row means for a new request.
import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import type { InvoiceStatus } from '../generated/prisma/client.js';
import { existingRowKind, isClosedRequest, paymentSettled, requestPayment, requestStateOf } from './enrollment-requests.policy.js';

const invoice = (status: InvoiceStatus, total: string, paid: string) => ({ status, totalAmount: new Prisma.Decimal(total), paidAmount: new Prisma.Decimal(paid) });
const at = new Date('2026-11-19T09:00:00.000Z');

describe('request payment state (D-R125)', () => {
  it('needs nothing for a free course without an invoice, and an invoice for a paid one', () => {
    expect(requestPayment(false, []).state).toBe('not_required');
    expect(requestPayment(true, []).state).toBe('missing');
    // Drafts and cancelled invoices are not owed.
    expect(requestPayment(true, [invoice('draft', '100', '0'), invoice('cancelled', '100', '0')]).state).toBe('missing');
  });

  it('sums every issued invoice: unpaid, partial, paid', () => {
    expect(requestPayment(true, [invoice('issued', '1200', '0')])).toEqual({ state: 'unpaid', total: '1200.00', paid: '0.00', balance: '1200.00' });
    expect(requestPayment(true, [invoice('issued', '1200', '400')])).toEqual({ state: 'partial', total: '1200.00', paid: '400.00', balance: '800.00' });
    expect(requestPayment(true, [invoice('issued', '1200', '1200')]).state).toBe('paid');
    // Two issued invoices: one paid does not settle the other.
    expect(requestPayment(true, [invoice('issued', '600', '600'), invoice('issued', '200', '0')]).state).toBe('partial');
    // An invoice issued for a course made free afterwards is still owed.
    expect(requestPayment(false, [invoice('issued', '50', '0')]).state).toBe('unpaid');
  });

  it('counts a fully discounted issued invoice as paid — the explicit waiver path', () => {
    expect(requestPayment(true, [invoice('issued', '0', '0')]).state).toBe('paid');
  });

  it('settles only paid and not_required', () => {
    expect(paymentSettled('paid')).toBe(true);
    expect(paymentSettled('not_required')).toBe(true);
    for (const state of ['missing', 'unpaid', 'partial'] as const) expect(paymentSettled(state)).toBe(false);
  });
});

describe('request state (D-R121)', () => {
  const row = (status: 'pending' | 'active' | 'completed' | 'withdrawn' | 'cancelled', extra: { activatedAt?: Date | null; rejectedAt?: Date | null } = {}) => ({
    status,
    activatedAt: extra.activatedAt ?? null,
    rejectedAt: extra.rejectedAt ?? null,
  });

  it('splits a pending request by its payment', () => {
    expect(requestStateOf(row('pending'), 'unpaid')).toBe('pending_payment');
    expect(requestStateOf(row('pending'), 'missing')).toBe('pending_payment');
    expect(requestStateOf(row('pending'), 'partial')).toBe('pending_payment');
    expect(requestStateOf(row('pending'), 'paid')).toBe('pending_approval');
    expect(requestStateOf(row('pending'), 'not_required')).toBe('pending_approval');
  });

  it('names the later life of a request and tells a rejection from a cancellation', () => {
    expect(requestStateOf(row('active', { activatedAt: at }), 'paid')).toBe('enrolled');
    expect(requestStateOf(row('completed', { activatedAt: at }), 'paid')).toBe('completed');
    expect(requestStateOf(row('withdrawn', { activatedAt: at }), 'paid')).toBe('withdrawn');
    expect(requestStateOf(row('cancelled', { rejectedAt: at }), 'missing')).toBe('rejected');
    expect(requestStateOf(row('cancelled'), 'missing')).toBe('cancelled');
  });
});

describe('an existing row of (class, student)', () => {
  it('reopens a closed request only; a pending one waits; anything else is taken (one row per class × student)', () => {
    expect(existingRowKind(null)).toBe('none');
    expect(existingRowKind({ status: 'pending', activatedAt: null })).toBe('pending');
    expect(existingRowKind({ status: 'cancelled', activatedAt: null })).toBe('reopen');
    expect(isClosedRequest({ status: 'cancelled', activatedAt: null })).toBe(true);
    // Cancelled after being active is an enrollment the office reactivates, not a request.
    expect(existingRowKind({ status: 'cancelled', activatedAt: at })).toBe('taken');
    for (const status of ['active', 'completed', 'withdrawn'] as const) expect(existingRowKind({ status, activatedAt: at })).toBe('taken');
  });
});
