// MOD-11 permission keys and the reading rules (roadmap §4i.3; owner decision
// D-R65), unit-tested in fee-plans.rules.spec.ts. Academy-wide: no class
// visibility; teachers hold no finance key.

export const FEE_PLANS_MANAGE_PERMISSION = 'fee_plans.manage';
export const INVOICES_MANAGE_PERMISSION = 'invoices.manage';
export const INVOICES_READ_ALL_PERMISSION = 'invoices.read_all';
export const INVOICES_READ_OWN_PERMISSION = 'invoices.read_own';
export const INVOICES_READ_LINKED_PERMISSION = 'invoices.read_linked';
export const PAYMENTS_RECORD_PERMISSION = 'payments.record';
export const PAYMENTS_REFUND_PERMISSION = 'payments.refund';

/** Fee plans are read by who manages them or creates invoices from them. */
export const FEE_PLAN_READ_PERMISSIONS = [FEE_PLANS_MANAGE_PERMISSION, INVOICES_MANAGE_PERMISSION] as const;
/** Invoices and payments are read with any of these (D-R65 — staff holds the last two, not read_all). */
export const INVOICE_READ_PERMISSIONS = [INVOICES_READ_ALL_PERMISSION, INVOICES_MANAGE_PERMISSION, PAYMENTS_RECORD_PERMISSION] as const;

/** The keys to report in `permission_denied` when the caller holds none of `keys`, else null. */
export function missingAny(permissions: readonly string[], keys: readonly string[]): string[] | null {
  return keys.some((key) => permissions.includes(key)) ? null : [...keys];
}
