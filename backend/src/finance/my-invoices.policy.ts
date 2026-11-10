// «My invoices» rules of MOD-11 (roadmap §4i; owner decision D-R65, the
// pattern of «my certificates» — D-R57) as pure functions, unit-tested in
// my-invoices.policy.spec.ts: which keys open which relation, and what of a
// payment its owner sees (the valid receipts only — never the recorder, the
// internal note or a reversed payment).
import { INVOICES_READ_LINKED_PERMISSION, INVOICES_READ_OWN_PERMISSION } from './finance.policy.js';

export interface MyInvoicesAccess {
  /** The caller's own invoices (`invoices.read_own`). */
  self: boolean;
  /** Their linked children's (`invoices.read_linked` — plus the guardian role, checked by the service). */
  child: boolean;
}

export function myInvoicesAccess(permissions: readonly string[]): MyInvoicesAccess {
  return { self: permissions.includes(INVOICES_READ_OWN_PERMISSION), child: permissions.includes(INVOICES_READ_LINKED_PERMISSION) };
}

/** The keys to report in `permission_denied` when the caller holds neither, else null. */
export function myInvoicesMissing(permissions: readonly string[]): string[] | null {
  const access = myInvoicesAccess(permissions);
  return access.self || access.child ? null : [INVOICES_READ_OWN_PERMISSION, INVOICES_READ_LINKED_PERMISSION];
}

export interface OwnerPayment {
  id: string;
  number: string;
  amount: number;
  method: string;
  paidAt: string;
  reference: string | null;
  payerName: string | null;
}

/** The receipts an owner sees: completed payments only, without the recorder, the note or any reversal detail. */
export function ownerPayments<M extends string>(
  payments: readonly (Omit<OwnerPayment, 'method'> & { method: M; status: string })[],
): (Omit<OwnerPayment, 'method'> & { method: M })[] {
  return payments
    .filter((payment) => payment.status === 'completed')
    .map((payment) => ({ id: payment.id, number: payment.number, amount: payment.amount, method: payment.method, paidAt: payment.paidAt, reference: payment.reference, payerName: payment.payerName }));
}
