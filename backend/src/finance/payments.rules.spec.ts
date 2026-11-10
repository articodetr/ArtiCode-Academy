// TEST-163 (unit) — MOD-11-T04 payment rules (D-R63): a payment within the
// balance in cents, and a `paidAt` that is not ahead of the clock beyond the
// tolerated skew.
import { describe, expect, it } from 'vitest';
import { PAID_AT_SKEW_MS, PAYMENT_METHODS, exceedsBalance, isFutureInstant } from './payments.rules.js';

describe('payment rules (TEST-163)', () => {
  it('accepts a payment up to the balance, to the cent', () => {
    expect(exceedsBalance('900.00', '1500.00', '600.00')).toBe(false);
    expect(exceedsBalance(900.01, '1500.00', '600.00')).toBe(true);
    expect(exceedsBalance('0.01', '1500.00', '1500.00')).toBe(true);
    // Decimal arithmetic: 0.1 + 0.2 paid of 0.3 leaves nothing.
    expect(exceedsBalance('0.01', '0.30', '0.30')).toBe(true);
    expect(exceedsBalance('0.10', '0.30', '0.20')).toBe(false);
  });

  it('refuses a paidAt beyond the clock skew and lists the five methods', () => {
    const now = new Date('2026-11-11T10:00:00Z');
    expect(isFutureInstant(new Date('2026-11-11T10:04:59Z'), now)).toBe(false);
    expect(isFutureInstant(new Date(now.getTime() + PAID_AT_SKEW_MS + 1), now)).toBe(true);
    expect(isFutureInstant(new Date('2020-01-01T00:00:00Z'), now)).toBe(false);
    expect(PAYMENT_METHODS).toEqual(['cash', 'bank_transfer', 'card', 'cheque', 'other']);
  });
});
