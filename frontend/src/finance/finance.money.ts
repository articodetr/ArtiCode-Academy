// Money and percentages of the finance screens (MOD-11-T07): amounts are JSON
// numbers with two decimals at most (numeric(12,2) — the server checks
// `IsDecimalNumber(2)` and refuses anything else with a 400), in one academy
// currency (D15 = D-R59). The form checks below mirror those rules before any
// request; sums for the mirrored invoice and plan rules run in integer cents,
// never in floating point (the server sums with Prisma.Decimal). Nothing here
// computes a paid amount, a balance or an overdue flag: those are the server's
// (D-R62, ADR-068). No React.
import { MONEY_MAX } from '../api/feePlans'

/**
 * A finite JSON number with at most two decimals. `Number(value.toFixed(2)) === value`
 * also refuses the exponent forms (`1e-7` has more than two decimals although its
 * text shows none — the owner's note 4 on #108).
 */
export function isTwoDecimalAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number(value.toFixed(2)) === value
}

/** An amount of a line, an installment or a payment: 0.01..MONEY_MAX with two decimals at most. */
export function isPositiveAmount(value: unknown): value is number {
  return isTwoDecimalAmount(value) && value >= 0.01 && value <= MONEY_MAX
}

/** A discount: 0..MONEY_MAX with two decimals at most. */
export function isDiscountAmount(value: unknown): value is number {
  return isTwoDecimalAmount(value) && value >= 0 && value <= MONEY_MAX
}

/** A share of a fee plan: 0.01..100 with two decimals at most. */
export function isSharePercent(value: unknown): value is number {
  return isTwoDecimalAmount(value) && value >= 0.01 && value <= 100
}

/** A whole number of days 0..max (the due offset of a share). */
export function isWholeDays(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
}

/** A two-decimal amount in cents (exact for every value isTwoDecimalAmount accepts up to MONEY_MAX). */
export function toCents(value: number): number {
  return Math.round(value * 100)
}

/** Cents back to the JSON number the server takes. */
export function fromCents(cents: number): number {
  return cents / 100
}

/** The sum in cents of the amounts that are valid; the others count as nothing (their own field shows why). */
export function sumCents(values: readonly unknown[]): number {
  return values.reduce<number>((sum, value) => (isTwoDecimalAmount(value) ? sum + toCents(value) : sum), 0)
}

/**
 * `total` cents split into `count` parts, each the same up to a cent, the
 * remainder on the last — what «split evenly» fills in (the server's own
 * split of a plan rounds half-up with the remainder on the last as well).
 */
export function evenSplitCents(total: number, count: number): number[] {
  if (count <= 0) return []
  const part = Math.floor(total / count)
  return Array.from({ length: count }, (_, index) => (index === count - 1 ? total - part * (count - 1) : part))
}
