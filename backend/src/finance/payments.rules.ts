// Payment rules of MOD-11 (roadmap §4i; owner decision D-R63) as pure
// functions, unit-tested in payments.rules.spec.ts: a payment never exceeds
// the invoice balance, and its `paidAt` is never in the future (a small clock
// skew is tolerated — the instant comes from the cashier's device).
import { Prisma } from '../generated/prisma/client.js';
import { PaymentMethod } from '../generated/prisma/client.js';

const D = (value: number | string | Prisma.Decimal) => new Prisma.Decimal(value);

export const PAYMENT_METHODS = Object.values(PaymentMethod) as PaymentMethod[];

/** How far ahead of the server clock a `paidAt` may be (another device's clock). */
export const PAID_AT_SKEW_MS = 5 * 60 * 1000;

/** True when `amount` is above what is left to pay (`total − paid`). */
export function exceedsBalance(amount: number | string, total: number | string, paid: number | string): boolean {
  return D(amount).greaterThan(D(total).minus(D(paid)));
}

/** True when `at` lies beyond `now` plus the tolerated skew. */
export function isFutureInstant(at: Date, now: Date, skewMs: number = PAID_AT_SKEW_MS): boolean {
  return at.getTime() > now.getTime() + skewMs;
}
