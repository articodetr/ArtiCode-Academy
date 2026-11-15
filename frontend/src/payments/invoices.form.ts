// Draft invoice rules of the payments screen (MOD-11-T03): a local mirror of
// `checkInvoice()` / `invoiceTotals()` of backend/src/finance/invoices.calc.ts
// and of the create rules of invoices.service.ts (`plan_with_lines`,
// `lines_required`) — keep them in sync. The forms show these problems on their
// fields before any request; the server checks them again and answers
// `400 invoice_invalid { problems }`, which `problemFields()` places on the same
// fields. Pure; amounts in cents.
import type { CreateInvoiceInput, Invoice, InvoiceInstallmentInput, UpdateInvoiceInput } from '../api/invoices'
import { canonical, fromCents, lineInputs, toCents } from './feePlans.rules'
import type { LineFormValue } from './feePlans.rules'

export type InvoiceProblem =
  | 'no_lines'
  | 'no_installments'
  | 'installments_sum'
  | 'due_dates_not_ascending'
  | 'installment_not_positive'
  | 'discount_exceeds_subtotal'
  | 'discount_reason_without_discount'
  | 'total_zero'
  | 'plan_with_lines'
  | 'lines_required'

export const INVOICE_PROBLEMS: readonly InvoiceProblem[] = [
  'no_lines',
  'no_installments',
  'installments_sum',
  'due_dates_not_ascending',
  'installment_not_positive',
  'discount_exceeds_subtotal',
  'discount_reason_without_discount',
  'total_zero',
  'plan_with_lines',
  'lines_required',
]

/** The form field each problem belongs to. */
export const PROBLEM_FIELDS: Record<InvoiceProblem, string> = {
  no_lines: 'lines',
  lines_required: 'lines',
  plan_with_lines: 'source',
  no_installments: 'installments',
  installments_sum: 'installments',
  due_dates_not_ascending: 'installments',
  installment_not_positive: 'installments',
  discount_exceeds_subtotal: 'discountAmount',
  total_zero: 'discountAmount',
  discount_reason_without_discount: 'discountReason',
}

export function isInvoiceProblem(value: unknown): value is InvoiceProblem {
  return typeof value === 'string' && (INVOICE_PROBLEMS as readonly string[]).includes(value)
}

/** `{ field: problems }` of a server refusal or a local check, in the dictionary's order. */
export function problemFields(problems: readonly InvoiceProblem[]): Record<string, InvoiceProblem[]> {
  const fields: Record<string, InvoiceProblem[]> = {}
  for (const problem of problems) (fields[PROBLEM_FIELDS[problem]] ??= []).push(problem)
  return fields
}

export interface InstallmentFormValue {
  amount?: number | null
  /** `YYYY-MM-DD` from a native date input. */
  dueOn?: string
}

export type InvoiceSource = 'lines' | 'plan'

export interface InvoiceFormValues {
  studentId?: string
  classId?: string
  source?: InvoiceSource
  feePlanId?: string
  lines?: LineFormValue[]
  installments?: InstallmentFormValue[]
  discountAmount?: number | null
  discountReason?: string
  notes?: string
}

const text = (value: string | undefined) => (value ?? '').trim()

export interface InvoiceDraftCheck {
  lines: readonly { amount: number }[]
  installments: readonly { amount: number; dueOn: string }[]
  discountAmount: number
  discountReason: string | null
}

/** `invoiceTotals()`: subtotal and total in currency units, two decimals. */
export function invoiceTotals(draft: Pick<InvoiceDraftCheck, 'lines' | 'discountAmount'>): { subtotal: number; total: number } {
  const subtotal = draft.lines.reduce((sum, line) => sum + toCents(line.amount), 0)
  return { subtotal: fromCents(subtotal), total: fromCents(subtotal - toCents(draft.discountAmount)) }
}

/** `checkInvoice()` (empty = valid). */
export function checkInvoice(draft: InvoiceDraftCheck): InvoiceProblem[] {
  const problems: InvoiceProblem[] = []
  if (draft.lines.length === 0) problems.push('no_lines')
  const { subtotal, total } = invoiceTotals(draft)
  if (toCents(draft.discountAmount) > toCents(subtotal)) problems.push('discount_exceeds_subtotal')
  if (draft.discountReason !== null && toCents(draft.discountAmount) === 0) problems.push('discount_reason_without_discount')
  if (!(toCents(total) > 0)) problems.push('total_zero')
  if (draft.installments.length === 0) problems.push('no_installments')
  else {
    const sum = draft.installments.reduce((acc, part) => acc + toCents(part.amount), 0)
    if (sum !== toCents(total)) problems.push('installments_sum')
    if (draft.installments.some((part, index) => index > 0 && part.dueOn < draft.installments[index - 1]!.dueOn)) problems.push('due_dates_not_ascending')
    if (draft.installments.some((part) => !(toCents(part.amount) > 0))) problems.push('installment_not_positive')
  }
  return problems
}

export function installmentInputs(installments: readonly InstallmentFormValue[] = []): InvoiceInstallmentInput[] {
  return installments.map((part) => ({ amount: Number(part.amount ?? 0), dueOn: part.dueOn ?? '' }))
}

function discountOf(values: InvoiceFormValues): { amount: number; reason: string | null } {
  return { amount: Number(values.discountAmount ?? 0), reason: text(values.discountReason) || null }
}

/**
 * The problems of the values as typed. For a draft from a plan the plan's lines and shares are the server's,
 * so only the discount is checked against the plan's total (`planTotal`).
 */
export function checkInvoiceValues(values: InvoiceFormValues, planTotal?: number): InvoiceProblem[] {
  const discount = discountOf(values)
  if (values.source === 'plan') {
    if (planTotal === undefined) return []
    const lines = [{ amount: planTotal }]
    return checkInvoice({ lines, installments: [{ amount: fromCents(toCents(planTotal) - toCents(discount.amount)), dueOn: '' }], discountAmount: discount.amount, discountReason: discount.reason }).filter(
      (problem) => problem !== 'installments_sum' && problem !== 'installment_not_positive',
    )
  }
  return checkInvoice({ lines: lineInputs(values.lines), installments: installmentInputs(values.installments), discountAmount: discount.amount, discountReason: discount.reason })
}

/** Body of API-146: a plan or lines + installments (never both), the discount only when set, blank texts absent. */
export function buildCreateInvoiceInput(values: InvoiceFormValues, enrollmentId: string | undefined): CreateInvoiceInput {
  const input: CreateInvoiceInput = { studentId: values.studentId ?? '' }
  if (enrollmentId) input.enrollmentId = enrollmentId
  if (values.source === 'plan') input.feePlanId = values.feePlanId
  else {
    input.lines = lineInputs(values.lines)
    input.installments = installmentInputs(values.installments)
  }
  const discount = discountOf(values)
  if (toCents(discount.amount) > 0) input.discountAmount = discount.amount
  if (discount.reason) input.discountReason = discount.reason
  if (text(values.notes)) input.notes = text(values.notes)
  return input
}

/** The edit form's starting values for a draft. */
export function invoiceFormValues(invoice: Invoice): InvoiceFormValues {
  return {
    source: 'lines',
    lines: invoice.lines.map((line) => ({ descriptionAr: line.description.ar, descriptionEn: line.description.en, descriptionTr: line.description.tr, amount: line.amount })),
    installments: invoice.installments.map((part) => ({ amount: part.amount, dueOn: part.dueOn })),
    discountAmount: invoice.discountAmount,
    discountReason: invoice.discountReason ?? undefined,
    notes: invoice.notes ?? undefined,
  }
}

/** Body of API-147: only what differs from the draft on screen; `null` clears the reason or the notes; `{}` = nothing to send. */
export function planInvoicePatch(invoice: Invoice, values: InvoiceFormValues): UpdateInvoiceInput {
  const patch: UpdateInvoiceInput = {}
  const lines = lineInputs(values.lines)
  const normalLines = (items: readonly { description: unknown; amount: number }[]) => items.map((line) => ({ description: line.description, amount: toCents(line.amount) }))
  if (canonical(normalLines(lines)) !== canonical(normalLines(invoice.lines))) patch.lines = lines
  const installments = installmentInputs(values.installments)
  const normalParts = (items: readonly { amount: number; dueOn: string }[]) => items.map((part) => ({ amount: toCents(part.amount), dueOn: part.dueOn }))
  if (canonical(normalParts(installments)) !== canonical(normalParts(invoice.installments))) patch.installments = installments
  const discount = discountOf(values)
  if (toCents(discount.amount) !== toCents(invoice.discountAmount)) patch.discountAmount = discount.amount
  if (discount.reason !== invoice.discountReason) patch.discountReason = discount.reason
  const notes = text(values.notes) || null
  if (notes !== invoice.notes) patch.notes = notes
  return patch
}

/** `total` over `count` installments, the remainder on the last (the plan split rule); keeps the due days given. */
export function spreadEvenly(total: number, parts: readonly InstallmentFormValue[]): InstallmentFormValue[] {
  const count = parts.length
  if (count === 0) return []
  const cents = toCents(total)
  const each = Math.floor(cents / count)
  return parts.map((part, index) => ({ ...part, amount: fromCents(index === count - 1 ? cents - each * (count - 1) : each) }))
}
