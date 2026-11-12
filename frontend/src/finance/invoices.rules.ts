// The invoice rules of the server (D-R60..D-R62, D-R64) — a manual mirror of
// `checkInvoice()`, `invoiceTotals()`, `planFits()`, `changedInvoiceFields()`
// and the status transitions of backend/src/finance/invoices.calc.ts, keep them
// in sync. The editors check a draft before any request (the server stays the
// boundary and answers `400 invoice_invalid { problems }` itself); sums run in
// integer cents. The paid parts, the balance and overdue are NOT mirrored: the
// screens show the server's values (ADR-068). No React.
import type { FeePlanLine } from '../api/feePlans'
import type { InvoiceInstallmentInput, InvoiceStatus, InvoiceStatusAction } from '../api/invoices'
import { isTwoDecimalAmount, sumCents, toCents } from './finance.money'
import { sameLocalizedText } from './feePlans.rules'

/** `InvoiceProblem` of finance.errors.ts, in the order `checkInvoice()` reports them (then the two create-only ones). */
export const INVOICE_PROBLEMS = [
  'no_lines',
  'discount_exceeds_subtotal',
  'discount_reason_without_discount',
  'total_zero',
  'no_installments',
  'installments_sum',
  'due_dates_not_ascending',
  'installment_not_positive',
  'plan_with_lines',
  'lines_required',
] as const
export type InvoiceProblem = (typeof INVOICE_PROBLEMS)[number]

export interface InvoiceDraftContent {
  lines: readonly { amount: number }[]
  installments: readonly { amount: number; dueOn: string }[]
  discountAmount: number
  discountReason: string | null
}

/** Subtotal and total in cents (`invoiceTotals()`): the sum of the lines, less the discount. */
export function invoiceTotalsCents(draft: Pick<InvoiceDraftContent, 'lines' | 'discountAmount'>): { subtotal: number; total: number } {
  const subtotal = sumCents(draft.lines.map((line) => line.amount))
  const discount = isTwoDecimalAmount(draft.discountAmount) ? toCents(draft.discountAmount) : 0
  return { subtotal, total: subtotal - discount }
}

/** The rules a draft breaks (empty = valid) — `checkInvoice()`, run on create, on every draft change and on issue. */
export function checkInvoice(draft: InvoiceDraftContent): InvoiceProblem[] {
  const problems: InvoiceProblem[] = []
  if (draft.lines.length === 0) problems.push('no_lines')
  const { subtotal, total } = invoiceTotalsCents(draft)
  const discount = isTwoDecimalAmount(draft.discountAmount) ? toCents(draft.discountAmount) : 0
  if (discount > subtotal) problems.push('discount_exceeds_subtotal')
  if (draft.discountReason !== null && discount === 0) problems.push('discount_reason_without_discount')
  if (!(total > 0)) problems.push('total_zero')
  if (draft.installments.length === 0) problems.push('no_installments')
  else {
    if (sumCents(draft.installments.map((part) => part.amount)) !== total) problems.push('installments_sum')
    if (draft.installments.some((part, index) => index > 0 && part.dueOn < draft.installments[index - 1]!.dueOn)) problems.push('due_dates_not_ascending')
    if (draft.installments.some((part) => !(isTwoDecimalAmount(part.amount) && toCents(part.amount) > 0))) problems.push('installment_not_positive')
  }
  return problems
}

/** A plan prices any class (a general plan), the classes of its course, or its one class (`planFits()` — D-R60). */
export function planFits(plan: { courseId: string | null; classId: string | null }, target: { classId: string; courseId: string }): boolean {
  return (plan.classId === null || plan.classId === target.classId) && (plan.courseId === null || plan.courseId === target.courseId)
}

/** What PATCH can change of a draft (`InvoiceContent` of invoices.calc.ts). */
export interface InvoiceContent {
  enrollmentId: string | null
  lines: FeePlanLine[]
  installments: InvoiceInstallmentInput[]
  discountAmount: number
  discountReason: string | null
  notes: string | null
}

export const INVOICE_FIELDS = ['enrollmentId', 'lines', 'installments', 'discountAmount', 'discountReason', 'notes'] as const
export type InvoiceField = (typeof INVOICE_FIELDS)[number]

/** The fields of `next` that differ from `current` — the smallest PATCH (`changedInvoiceFields()`: lines and installments compared whole). */
export function changedInvoiceFields(current: InvoiceContent, next: InvoiceContent): InvoiceField[] {
  const sameLines =
    current.lines.length === next.lines.length &&
    current.lines.every((line, index) => sameLocalizedText(line.description, next.lines[index]!.description) && toCents(line.amount) === toCents(next.lines[index]!.amount))
  const sameParts =
    current.installments.length === next.installments.length &&
    current.installments.every((part, index) => toCents(part.amount) === toCents(next.installments[index]!.amount) && part.dueOn === next.installments[index]!.dueOn)
  const changed: InvoiceField[] = []
  if (current.enrollmentId !== next.enrollmentId) changed.push('enrollmentId')
  if (!sameLines) changed.push('lines')
  if (!sameParts) changed.push('installments')
  if (toCents(current.discountAmount) !== toCents(next.discountAmount)) changed.push('discountAmount')
  if (current.discountReason !== next.discountReason) changed.push('discountReason')
  if (current.notes !== next.notes) changed.push('notes')
  return changed
}

/** The status an action leads to from `from`, or null (`nextInvoiceStatus()` — D-R61: issue draft → issued, cancel issued → cancelled). */
export function nextInvoiceStatus(action: InvoiceStatusAction, from: InvoiceStatus): InvoiceStatus | null {
  if (action === 'issue') return from === 'draft' ? 'issued' : null
  return from === 'issued' ? 'cancelled' : null
}
