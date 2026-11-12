// The invoice editor's values (J-F52 — API-146 by hand, API-147 for a draft)
// and their way to the server: the content of a draft, the smallest PATCH (no
// request when nothing changed — the mirror of `changedInvoiceFields()` in
// invoices.rules.ts) and the unsaved-work test (compared the way the planner
// does, so a change changed back holds nothing). The preview of the totals is
// the form's own arithmetic on what is typed — once saved, the screens show the
// server's values only. No React.
import type { CreateInvoiceInput, Invoice, InvoiceInstallmentInput, UpdateInvoiceInput } from '../api/invoices'
import type { AcademyClass } from '../api/classes'
import type { FeePlan, FeePlanLine } from '../api/feePlans'
import { isCalendarDate } from '../timetable/timetable.dates'
import { evenSplitCents, fromCents, isDiscountAmount, isPositiveAmount, isTwoDecimalAmount, toCents } from './finance.money'
import { localizedOf } from './feePlans.form'
import { changedInvoiceFields, checkInvoice, invoiceTotalsCents, planFits } from './invoices.rules'
import type { InvoiceContent, InvoiceProblem } from './invoices.rules'

export interface InvoiceLineFormValues {
  descriptionAr?: string
  descriptionEn?: string
  /** Kept as the invoice holds it (the form does not show it). */
  descriptionTr?: string
  amount?: number | null
}

export interface InstallmentFormValues {
  amount?: number | null
  /** `YYYY-MM-DD` (a native date input). */
  dueOn?: string
}

/** What the create (by hand) and edit forms share: the content of a draft. */
export interface InvoiceContentFormValues {
  lines?: InvoiceLineFormValues[]
  installments?: InstallmentFormValues[]
  /** Blank = no discount. */
  discountAmount?: number | null
  discountReason?: string
  notes?: string
}

/** The edit form of a draft: its content, and whether it stays tied to its enrollment. */
export interface InvoiceEditFormValues extends InvoiceContentFormValues {
  keepEnrollment?: boolean
}

const text = (value: string | undefined | null) => (value ?? '').trim()

export function emptyInvoiceLine(): InvoiceLineFormValues {
  return { descriptionAr: '', descriptionEn: '', descriptionTr: '', amount: null }
}

/** A new invoice by hand: one line and one installment due `today` to fill. */
export function newInvoiceContentForm(today: string): InvoiceContentFormValues {
  return { lines: [emptyInvoiceLine()], installments: [{ amount: null, dueOn: today }], discountAmount: null, discountReason: '', notes: '' }
}

export function invoiceEditFormValuesOf(invoice: Invoice): InvoiceEditFormValues {
  return {
    lines: invoice.lines.map((line) => ({ descriptionAr: line.description.ar, descriptionEn: line.description.en ?? '', descriptionTr: line.description.tr ?? '', amount: line.amount })),
    installments: invoice.installments.map((part) => ({ amount: part.amount, dueOn: part.dueOn })),
    discountAmount: invoice.discountAmount === 0 ? null : invoice.discountAmount,
    discountReason: invoice.discountReason ?? '',
    notes: invoice.notes ?? '',
    keepEnrollment: invoice.enrollment !== null,
  }
}

/** A blank discount is no discount. */
function discountOf(value: number | null | undefined): number {
  return typeof value === 'number' ? value : 0
}

/** The content the form describes (call once the fields are valid); blank texts are absent (`null`). */
export function invoiceContentOf(values: InvoiceContentFormValues, enrollmentId: string | null): InvoiceContent {
  return {
    enrollmentId,
    lines: (values.lines ?? []).map((line): FeePlanLine => ({ description: localizedOf(line.descriptionAr, line.descriptionEn, line.descriptionTr), amount: line.amount as number })),
    installments: (values.installments ?? []).map((part): InvoiceInstallmentInput => ({ amount: part.amount as number, dueOn: part.dueOn as string })),
    discountAmount: discountOf(values.discountAmount),
    discountReason: text(values.discountReason) || null,
    notes: text(values.notes) || null,
  }
}

/** Every line and installment and the discount hold valid values — only then are the invoice rules worth checking. */
export function invoiceFormComplete(values: InvoiceContentFormValues): boolean {
  const lines = values.lines ?? []
  const parts = values.installments ?? []
  return (
    lines.every((line) => text(line.descriptionAr) !== '' && isPositiveAmount(line.amount)) &&
    parts.every((part) => isPositiveAmount(part.amount) && isCalendarDate(part.dueOn)) &&
    (values.discountAmount === null || values.discountAmount === undefined || isDiscountAmount(values.discountAmount))
  )
}

/** The invoice rules the form breaks (the mirror of `checkInvoice()`), once its fields are valid. */
export function invoiceFormProblems(values: InvoiceContentFormValues): InvoiceProblem[] {
  if (!invoiceFormComplete(values)) return []
  return checkInvoice(invoiceContentOf(values, null))
}

/** The body of API-146 by hand (the student, enrollment and discount are added by the caller). */
export function manualInvoiceInput(values: InvoiceContentFormValues): Pick<CreateInvoiceInput, 'lines' | 'installments' | 'discountAmount' | 'discountReason' | 'notes'> {
  const content = invoiceContentOf(values, null)
  const input: Pick<CreateInvoiceInput, 'lines' | 'installments' | 'discountAmount' | 'discountReason' | 'notes'> = {
    lines: content.lines,
    installments: content.installments,
  }
  if (content.discountAmount > 0) input.discountAmount = content.discountAmount
  if (content.discountReason) input.discountReason = content.discountReason
  if (content.notes) input.notes = content.notes
  return input
}

function contentOfInvoice(invoice: Invoice): InvoiceContent {
  return {
    enrollmentId: invoice.enrollment?.id ?? null,
    lines: invoice.lines.map((line) => ({ description: line.description, amount: line.amount })),
    installments: invoice.installments.map((part) => ({ amount: part.amount, dueOn: part.dueOn })),
    discountAmount: invoice.discountAmount,
    discountReason: invoice.discountReason,
    notes: invoice.notes,
  }
}

/** The smallest PATCH of API-147 (whole lines/installments when they differ), or null when nothing changed. */
export function planInvoicePatch(invoice: Invoice, values: InvoiceEditFormValues): UpdateInvoiceInput | null {
  const enrollmentId = values.keepEnrollment === false ? null : (invoice.enrollment?.id ?? null)
  const next = invoiceContentOf(values, enrollmentId)
  const fields = changedInvoiceFields(contentOfInvoice(invoice), next)
  if (fields.length === 0) return null
  const patch: UpdateInvoiceInput = {}
  for (const field of fields) {
    if (field === 'enrollmentId') patch.enrollmentId = next.enrollmentId
    if (field === 'lines') patch.lines = next.lines
    if (field === 'installments') patch.installments = next.installments
    if (field === 'discountAmount') patch.discountAmount = next.discountAmount
    if (field === 'discountReason') patch.discountReason = next.discountReason
    if (field === 'notes') patch.notes = next.notes
  }
  return patch
}

/** The form's values as the planner reads them: trimmed texts, amounts in cents, a blank discount as zero. */
function normalised(values: InvoiceEditFormValues): string {
  const cents = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? toCents(value) : null)
  return JSON.stringify({
    lines: (values.lines ?? []).map((line) => [text(line.descriptionAr), text(line.descriptionEn), text(line.descriptionTr), cents(line.amount)]),
    installments: (values.installments ?? []).map((part) => [cents(part.amount), part.dueOn ?? '']),
    discount: cents(discountOf(values.discountAmount)),
    reason: text(values.discountReason),
    notes: text(values.notes),
    keepEnrollment: values.keepEnrollment ?? null,
  })
}

/** Whether the form holds unsaved work: what it holds differs from what it started with. */
export function invoiceFormHasChanges(initial: InvoiceEditFormValues, values: InvoiceEditFormValues): boolean {
  return normalised(initial) !== normalised(values)
}

/** The form's own preview of what is typed, in cents (null while an amount is not valid). */
export interface InvoicePreview {
  subtotal: number | null
  discount: number | null
  total: number | null
  installments: number | null
}

export function invoicePreview(values: InvoiceContentFormValues): InvoicePreview {
  const lines = values.lines ?? []
  const parts = values.installments ?? []
  const linesValid = lines.length > 0 && lines.every((line) => isTwoDecimalAmount(line.amount))
  const discountValid = values.discountAmount === null || values.discountAmount === undefined || isTwoDecimalAmount(values.discountAmount)
  const totals = linesValid && discountValid ? invoiceTotalsCents({ lines: lines as { amount: number }[], discountAmount: discountOf(values.discountAmount) }) : null
  const partsValid = parts.length > 0 && parts.every((part) => isTwoDecimalAmount(part.amount))
  return {
    subtotal: totals?.subtotal ?? null,
    discount: discountValid ? toCents(discountOf(values.discountAmount)) : null,
    total: totals?.total ?? null,
    installments: partsValid ? parts.reduce((sum, part) => sum + toCents(part.amount as number), 0) : null,
  }
}

/** Where the student of a new invoice comes from: a class roster (the invoice is tied to the enrollment) or a name search. */
export type InvoiceTarget = 'class' | 'student'
/** What a new invoice holds: a fee plan's copy, or lines and installments typed by hand. */
export type InvoiceSource = 'plan' | 'manual'

/** The new-invoice form (API-146). */
export interface CreateInvoiceFormValues extends InvoiceContentFormValues {
  target?: InvoiceTarget
  classId?: string
  /** The roster entry chosen (target `class`). */
  enrollmentId?: string
  /** The student chosen by name (target `student`). */
  studentId?: string
  source?: InvoiceSource
  feePlanId?: string
}

export function newCreateInvoiceForm(target: InvoiceTarget, today: string): CreateInvoiceFormValues {
  return { ...newInvoiceContentForm(today), target, source: 'plan' }
}

/** Body of API-146 for the chosen student (and enrollment): the plan's id, or the typed lines and installments. */
export function buildCreateInvoiceInput(values: CreateInvoiceFormValues, student: { studentId: string; enrollmentId?: string }): CreateInvoiceInput {
  const input: CreateInvoiceInput = { studentId: student.studentId }
  if (student.enrollmentId) input.enrollmentId = student.enrollmentId
  if (values.source === 'manual') return { ...input, ...manualInvoiceInput(values) }
  if (values.feePlanId) input.feePlanId = values.feePlanId
  const content = invoiceContentOf({ ...values, lines: [], installments: [] }, null)
  if (content.discountAmount > 0) input.discountAmount = content.discountAmount
  if (content.discountReason) input.discountReason = content.discountReason
  if (content.notes) input.notes = content.notes
  return input
}

/**
 * The rules a draft from a plan breaks with the typed discount (the server
 * splits the installments itself): the discount within the plan's total, its
 * reason only with a discount, a total above zero — `checkInvoice()` on the
 * plan's lines.
 */
export function planInvoiceProblems(planTotal: number, values: InvoiceContentFormValues): InvoiceProblem[] {
  if (values.discountAmount !== null && values.discountAmount !== undefined && !isDiscountAmount(values.discountAmount)) return []
  const discountAmount = discountOf(values.discountAmount)
  const total = toCents(planTotal) - toCents(discountAmount)
  const problems = checkInvoice({ lines: [{ amount: planTotal }], installments: [{ amount: fromCents(Math.max(total, 1)), dueOn: '' }], discountAmount, discountReason: text(values.discountReason) || null })
  return problems.filter((problem) => problem === 'discount_exceeds_subtotal' || problem === 'discount_reason_without_discount' || problem === 'total_zero')
}

/** The active plans the server would accept for a class: its own, its course's or general ones (`planFits()`); without a class every active plan. */
export function plansForClass(plans: readonly FeePlan[], klass: Pick<AcademyClass, 'id' | 'course'> | null): FeePlan[] {
  return plans.filter((plan) => plan.isActive && (!klass || planFits({ courseId: plan.course?.id ?? null, classId: plan.class?.id ?? null }, { classId: klass.id, courseId: klass.course.id })))
}

/** Whether the new-invoice form holds unsaved work: anything chosen or typed beyond what it started with. */
export function createInvoiceFormHasChanges(initial: CreateInvoiceFormValues, values: CreateInvoiceFormValues): boolean {
  const shape = (form: CreateInvoiceFormValues) =>
    JSON.stringify([form.target ?? null, form.classId ?? null, form.enrollmentId ?? null, form.studentId ?? null, form.source ?? null, form.feePlanId ?? null])
  return shape(initial) !== shape(values) || invoiceFormHasChanges(initial, values)
}

/** The installments with `total` cents split evenly over them (the remainder on the last), their due days kept. */
export function evenInstallments(parts: readonly InstallmentFormValues[], totalCents: number): InstallmentFormValues[] {
  const amounts = evenSplitCents(totalCents, parts.length)
  return parts.map((part, index) => ({ ...part, amount: fromCents(amounts[index]!) }))
}
