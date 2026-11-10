// Invoice rules and computed state of MOD-11 (roadmap §4i; owner decisions
// D-R61/D-R62/D-R64) as pure functions, unit-tested in invoices.calc.spec.ts:
//
//   check     lines (1..50, positive), installments (1..24, positive, due
//             dates non-decreasing, summing to the total), a discount within
//             the subtotal (its reason only with a discount), a total above 0
//   allocate  the paid amount covers the installments in order (FIFO): each is
//             paid, partial or unpaid, and overdue when due before today and
//             not fully covered (D-R62 — nothing of this is stored)
//   state     unpaid / partial / paid of an issued invoice; its next due part
import { Prisma } from '../generated/prisma/client.js';
import type { InvoiceProblem } from './finance.errors.js';

const D = (value: number | string | Prisma.Decimal) => new Prisma.Decimal(value);

export interface InvoiceDraft {
  lines: readonly { amount: number | string }[];
  installments: readonly { amount: number | string; dueOn: string }[];
  discountAmount: number | string;
  discountReason: string | null;
}

/** subtotal, total (two-decimal text). */
export function invoiceTotals(draft: Pick<InvoiceDraft, 'lines' | 'discountAmount'>): { subtotal: string; total: string } {
  const subtotal = draft.lines.reduce((sum, line) => sum.plus(D(line.amount)), D(0));
  return { subtotal: subtotal.toFixed(2), total: subtotal.minus(D(draft.discountAmount)).toFixed(2) };
}

/** The rules an invoice breaks (empty = valid) — checked on create, on every draft change and on issue. */
export function checkInvoice(draft: InvoiceDraft): InvoiceProblem[] {
  const problems: InvoiceProblem[] = [];
  if (draft.lines.length === 0) problems.push('no_lines');
  const { subtotal, total } = invoiceTotals(draft);
  if (D(draft.discountAmount).greaterThan(D(subtotal))) problems.push('discount_exceeds_subtotal');
  if (draft.discountReason !== null && D(draft.discountAmount).isZero()) problems.push('discount_reason_without_discount');
  if (!D(total).greaterThan(0)) problems.push('total_zero');
  if (draft.installments.length === 0) problems.push('no_installments');
  else {
    const sum = draft.installments.reduce((acc, part) => acc.plus(D(part.amount)), D(0));
    if (!sum.equals(D(total))) problems.push('installments_sum');
    if (draft.installments.some((part, index) => index > 0 && part.dueOn < draft.installments[index - 1]!.dueOn)) problems.push('due_dates_not_ascending');
    // A plan's shares can round a tiny total into a zero (or negative) part.
    if (draft.installments.some((part) => !D(part.amount).greaterThan(0))) problems.push('installment_not_positive');
  }
  return problems;
}

/** A plan prices any class (general), the classes of its course, or its one class (D-R60). */
export function planFits(plan: { courseId: string | null; classId: string | null }, target: { classId: string; courseId: string }): boolean {
  return (plan.classId === null || plan.classId === target.classId) && (plan.courseId === null || plan.courseId === target.courseId);
}

/** What a draft holds that PATCH can change (amounts as two-decimal text). */
export interface InvoiceContent {
  enrollmentId: string | null;
  lines: readonly { description: unknown; amount: string }[];
  installments: readonly { amount: string; dueOn: string }[];
  discountAmount: string;
  discountReason: string | null;
  notes: string | null;
}

export const INVOICE_FIELDS = ['enrollmentId', 'lines', 'installments', 'discountAmount', 'discountReason', 'notes'] as const;
export type InvoiceField = (typeof INVOICE_FIELDS)[number];

/** The fields of `next` that differ from `current` — the smallest PATCH (lines and installments compared whole). */
export function changedInvoiceFields(current: InvoiceContent, next: InvoiceContent, canonical: (value: unknown) => string): InvoiceField[] {
  const lineText = (lines: InvoiceContent['lines']) => canonical(lines.map((line) => ({ description: line.description, amount: D(line.amount).toFixed(2) })));
  const partText = (parts: InvoiceContent['installments']) => canonical(parts.map((part) => ({ amount: D(part.amount).toFixed(2), dueOn: part.dueOn })));
  const changed: InvoiceField[] = [];
  if (current.enrollmentId !== next.enrollmentId) changed.push('enrollmentId');
  if (lineText(current.lines) !== lineText(next.lines)) changed.push('lines');
  if (partText(current.installments) !== partText(next.installments)) changed.push('installments');
  if (!D(current.discountAmount).equals(D(next.discountAmount))) changed.push('discountAmount');
  if (current.discountReason !== next.discountReason) changed.push('discountReason');
  if (current.notes !== next.notes) changed.push('notes');
  return changed;
}

export type InstallmentStatus = 'paid' | 'partial' | 'unpaid';

export interface AllocatedInstallment {
  seq: number;
  amount: string;
  dueOn: string;
  paid: string;
  remaining: string;
  status: InstallmentStatus;
  overdue: boolean;
}

/** FIFO allocation of `paid` over the installments (in `seq` order); overdue = due before `today` and not fully covered. */
export function allocate(installments: readonly { seq: number; amount: string; dueOn: string }[], paid: string, today: string): AllocatedInstallment[] {
  let left = D(paid);
  return [...installments]
    .sort((a, b) => a.seq - b.seq)
    .map((part) => {
      const amount = D(part.amount);
      const covered = Prisma.Decimal.min(amount, Prisma.Decimal.max(left, 0));
      left = left.minus(covered);
      const remaining = amount.minus(covered);
      const status: InstallmentStatus = remaining.isZero() ? 'paid' : covered.isZero() ? 'unpaid' : 'partial';
      return { seq: part.seq, amount: amount.toFixed(2), dueOn: part.dueOn, paid: covered.toFixed(2), remaining: remaining.toFixed(2), status, overdue: !remaining.isZero() && part.dueOn < today };
    });
}

export type PaymentState = 'unpaid' | 'partial' | 'paid';

export function paymentStateOf(total: string, paid: string): PaymentState {
  if (D(paid).isZero()) return 'unpaid';
  return D(paid).greaterThanOrEqualTo(D(total)) ? 'paid' : 'partial';
}

export function balanceOf(total: string, paid: string): string {
  return D(total).minus(D(paid)).toFixed(2);
}

/** The first installment not fully covered, or null. */
export function nextDueOf(allocated: readonly AllocatedInstallment[]): { seq: number; dueOn: string; remaining: string } | null {
  const next = allocated.find((part) => part.status !== 'paid');
  return next ? { seq: next.seq, dueOn: next.dueOn, remaining: next.remaining } : null;
}

/** The calendar day of an instant in a time zone (`YYYY-MM-DD`; UTC when the zone is unknown). */
export function dayIn(timeZone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Invoice status actions (D-R61): issue draft → issued; cancel issued → cancelled. */
export const INVOICE_STATUS_ACTIONS = ['issue', 'cancel'] as const;
export type InvoiceStatusAction = (typeof INVOICE_STATUS_ACTIONS)[number];
const TRANSITIONS: Record<InvoiceStatusAction, { from: string; to: 'issued' | 'cancelled' }> = {
  issue: { from: 'draft', to: 'issued' },
  cancel: { from: 'issued', to: 'cancelled' },
};

/** The status an action leads to from `from`, or null. */
export function nextInvoiceStatus(action: InvoiceStatusAction, from: string): 'issued' | 'cancelled' | null {
  return TRANSITIONS[action].from === from ? TRANSITIONS[action].to : null;
}

export function allowedInvoiceActions(from: string): InvoiceStatusAction[] {
  return INVOICE_STATUS_ACTIONS.filter((action) => TRANSITIONS[action].from === from);
}

/** `PREFIX-YYYY-NNNNN` — the invoice and receipt numbers (D-R61/D-R63), as the certificate serials. */
export function formatNumber(prefix: string, year: string, value: number): string {
  return `${prefix}-${year}-${String(value).padStart(5, '0')}`;
}
