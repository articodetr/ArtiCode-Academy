// Fee plan rules of the payments screen (MOD-11-T02): a local mirror of
// backend/src/finance/fee-plans.rules.ts — `checkPlan()` (installment shares
// summing to exactly 100, non-decreasing day offsets, a course or a class but
// not both) and `planFeePlanUpdate()` (the smallest change) — keep them in sync.
// The form shows these problems on their fields before any request; the server
// checks them again (`400 fee_plan_invalid { problems }`). Pure: amounts are
// compared in cents, so 33.33 + 33.33 + 33.34 is exactly 100.
import type { CreateFeePlanInput, FeePlan, FeePlanLine, FeePlanShare, UpdateFeePlanInput } from '../api/feePlans'
import type { LocalizedLabel } from '../api/users'

export type FeePlanProblem = 'course_and_class' | 'percent_sum' | 'offsets_not_ascending'
export const FEE_PLAN_PROBLEMS: readonly FeePlanProblem[] = ['course_and_class', 'percent_sum', 'offsets_not_ascending']

/** What the plan prices: any class, the classes of a course, or one class (D-R60). */
export type FeePlanScope = 'any' | 'course' | 'class'

export const toCents = (value: number) => Math.round(value * 100)
export const fromCents = (cents: number) => cents / 100

export interface LineFormValue {
  descriptionAr?: string
  descriptionEn?: string
  /** A Turkish text the server already holds, carried along unchanged (the form has no field for it). */
  descriptionTr?: string
  amount?: number | null
}

export interface ShareFormValue {
  percent?: number | null
  dueOffsetDays?: number | null
}

export interface FeePlanFormValues {
  nameAr?: string
  nameEn?: string
  scope?: FeePlanScope
  courseId?: string
  classId?: string
  lines?: LineFormValue[]
  installments?: ShareFormValue[]
}

const text = (value: string | undefined) => (value ?? '').trim()

/** `checkPlan()` of fee-plans.rules.ts (empty = valid). */
export function checkPlan(plan: { courseId: string | null; classId: string | null; installments: readonly { percent: number; dueOffsetDays: number }[] }): FeePlanProblem[] {
  const problems: FeePlanProblem[] = []
  if (plan.courseId !== null && plan.classId !== null) problems.push('course_and_class')
  const sum = plan.installments.reduce((total, share) => total + toCents(share.percent), 0)
  if (sum !== 10_000) problems.push('percent_sum')
  if (plan.installments.some((share, index) => index > 0 && share.dueOffsetDays < plan.installments[index - 1]!.dueOffsetDays)) problems.push('offsets_not_ascending')
  return problems
}

/** The index of the first share whose offset is below the previous one, or -1. */
export function firstDescendingOffset(installments: readonly ShareFormValue[]): number {
  return installments.findIndex((share, index) => index > 0 && Number(share.dueOffsetDays ?? 0) < Number(installments[index - 1]!.dueOffsetDays ?? 0))
}

/** The sum of the shares in percent (two decimals), for the hint under the list. */
export function sharesTotal(installments: readonly ShareFormValue[]): number {
  return fromCents(installments.reduce((sum, share) => sum + toCents(Number(share.percent ?? 0)), 0))
}

/** The sum of the lines, two decimals. */
export function linesTotal(lines: readonly { amount?: number | null }[]): number {
  return fromCents(lines.reduce((sum, line) => sum + toCents(Number(line.amount ?? 0)), 0))
}

/** Equal shares summing to exactly 100, the remainder on the last (the server's split rule). */
export function evenShares(count: number): number[] {
  if (count <= 0) return []
  const each = Math.floor(10_000 / count)
  return Array.from({ length: count }, (_, index) => fromCents(index === count - 1 ? 10_000 - each * (count - 1) : each))
}

export function localizedOf(ar: string | undefined, en: string | undefined, tr?: string): LocalizedLabel {
  const label: LocalizedLabel = { ar: text(ar) }
  if (text(en)) label.en = text(en)
  if (tr) label.tr = tr
  return label
}

export function lineInputs(lines: readonly LineFormValue[] = []): FeePlanLine[] {
  return lines.map((line) => ({ description: localizedOf(line.descriptionAr, line.descriptionEn, line.descriptionTr), amount: Number(line.amount) }))
}

export function shareInputs(installments: readonly ShareFormValue[] = []): FeePlanShare[] {
  return installments.map((share) => ({ percent: Number(share.percent), dueOffsetDays: Number(share.dueOffsetDays ?? 0) }))
}

function scopeIds(values: FeePlanFormValues): { courseId: string | null; classId: string | null } {
  return {
    courseId: values.scope === 'course' ? (values.courseId ?? null) : null,
    classId: values.scope === 'class' ? (values.classId ?? null) : null,
  }
}

/** The problems of the values as typed (the scope radio already keeps course and class apart). */
export function checkPlanValues(values: FeePlanFormValues): FeePlanProblem[] {
  return checkPlan({ ...scopeIds(values), installments: shareInputs(values.installments) })
}

/** Body of API-141: the scope's id only. */
export function buildCreateFeePlanInput(values: FeePlanFormValues): CreateFeePlanInput {
  const { courseId, classId } = scopeIds(values)
  const input: CreateFeePlanInput = {
    name: localizedOf(values.nameAr, values.nameEn),
    lines: lineInputs(values.lines),
    installments: shareInputs(values.installments),
  }
  if (courseId) input.courseId = courseId
  if (classId) input.classId = classId
  return input
}

/** JSON text with sorted keys — compares what the server holds with the form (`canonical()` of the backend). */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const normalLines = (lines: readonly FeePlanLine[]) => lines.map((line) => ({ description: line.description, amount: toCents(line.amount) }))
const normalShares = (shares: readonly FeePlanShare[]) => shares.map((share) => ({ percent: toCents(share.percent), dueOffsetDays: share.dueOffsetDays }))

/** Body of API-142: only what differs from the plan on screen (`planFeePlanUpdate()`); `{}` = nothing to send. */
export function planFeePlanPatch(plan: FeePlan, values: FeePlanFormValues): UpdateFeePlanInput {
  const patch: UpdateFeePlanInput = {}
  const name = localizedOf(values.nameAr, values.nameEn, plan.name.tr)
  if (canonical(name) !== canonical(plan.name)) patch.name = name
  const { courseId, classId } = scopeIds(values)
  if (courseId !== (plan.course?.id ?? null)) patch.courseId = courseId
  if (classId !== (plan.class?.id ?? null)) patch.classId = classId
  const lines = lineInputs(values.lines)
  if (canonical(normalLines(lines)) !== canonical(normalLines(plan.lines))) patch.lines = lines
  const installments = shareInputs(values.installments)
  if (canonical(normalShares(installments)) !== canonical(normalShares(plan.installments))) patch.installments = installments
  return patch
}

/** The form's starting values: a new plan (one line, one share of 100 at day 0) or the plan on screen. */
export function feePlanFormValues(plan: FeePlan | null): FeePlanFormValues {
  if (!plan) return { scope: 'any', lines: [{}], installments: [{ percent: 100, dueOffsetDays: 0 }] }
  return {
    nameAr: plan.name.ar,
    nameEn: plan.name.en,
    scope: plan.class ? 'class' : plan.course ? 'course' : 'any',
    courseId: plan.course?.id,
    classId: plan.class?.id,
    lines: plan.lines.map((line) => ({ descriptionAr: line.description.ar, descriptionEn: line.description.en, descriptionTr: line.description.tr, amount: line.amount })),
    installments: plan.installments.map((share) => ({ percent: share.percent, dueOffsetDays: share.dueOffsetDays })),
  }
}

/** A plan prices any class (general), the classes of its course, or its one class — `planFits()` of invoices.calc.ts. */
export function planFits(plan: { course: { id: string } | null; class: { id: string } | null }, target: { classId: string; courseId: string }): boolean {
  return (plan.class === null || plan.class.id === target.classId) && (plan.course === null || plan.course.id === target.courseId)
}
