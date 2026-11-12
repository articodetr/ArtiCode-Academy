// MOD-11 permission keys and the reading rules (roadmap §4i.3; owner decision
// D-R65) — a manual mirror of backend/src/finance/finance.policy.ts, keep it in
// sync. Academy-wide: no class visibility; teachers hold no finance key. The
// screens use these to hide what a caller cannot use; the server stays the
// boundary.

export const FEE_PLANS_MANAGE_PERMISSION = 'fee_plans.manage'
export const INVOICES_MANAGE_PERMISSION = 'invoices.manage'
export const INVOICES_READ_ALL_PERMISSION = 'invoices.read_all'
export const PAYMENTS_RECORD_PERMISSION = 'payments.record'
export const PAYMENTS_REFUND_PERMISSION = 'payments.refund'

/** Fee plans are read by who manages them or creates invoices from them (API-140). */
export const FEE_PLAN_READ_PERMISSIONS = [FEE_PLANS_MANAGE_PERMISSION, INVOICES_MANAGE_PERMISSION] as const
/** Invoices and payments are read with any of these (API-144/145/152/153 — staff holds the last two, not read_all). */
export const INVOICE_READ_PERMISSIONS = [INVOICES_READ_ALL_PERMISSION, INVOICES_MANAGE_PERMISSION, PAYMENTS_RECORD_PERMISSION] as const

/** True when the caller holds at least one of `keys`. */
export function holdsAny(permissions: readonly string[], keys: readonly string[]): boolean {
  return keys.some((key) => permissions.includes(key))
}
