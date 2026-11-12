// The fee plan rules of the server (D-R60) — a manual mirror of `checkPlan()`
// and `planFeePlanUpdate()` in backend/src/finance/fee-plans.rules.ts, keep
// them in sync. The editor checks a plan before any request (the server stays
// the boundary and answers `400 fee_plan_invalid { problems }` itself); the
// sums run in integer cents (the server sums with Prisma.Decimal). No React.
import type { FeePlanLine, FeePlanShare } from '../api/feePlans'
import type { LocalizedLabel } from '../api/users'
import { isTwoDecimalAmount, sumCents, toCents } from './finance.money'

/** `FeePlanProblem` of finance.errors.ts, in the order `checkPlan()` reports them. */
export const FEE_PLAN_PROBLEMS = ['course_and_class', 'percent_sum', 'offsets_not_ascending'] as const
export type FeePlanProblem = (typeof FEE_PLAN_PROBLEMS)[number]

/** The shares of a plan sum to exactly 100 (in cents: 10000). */
export const PERCENT_TOTAL_CENTS = 10_000

/** The rules a plan breaks (empty = valid) — `checkPlan()`. */
export function checkPlan(plan: { courseId: string | null; classId: string | null; installments: readonly FeePlanShare[] }): FeePlanProblem[] {
  const problems: FeePlanProblem[] = []
  if (plan.courseId !== null && plan.classId !== null) problems.push('course_and_class')
  if (sumCents(plan.installments.map((share) => share.percent)) !== PERCENT_TOTAL_CENTS) problems.push('percent_sum')
  if (plan.installments.some((share, index) => index > 0 && share.dueOffsetDays < plan.installments[index - 1]!.dueOffsetDays)) problems.push('offsets_not_ascending')
  return problems
}

/** The two-decimal sum of the shares, for the editor's running total (null while a share is not a valid number). */
export function percentSum(percents: readonly unknown[]): number | null {
  return percents.every(isTwoDecimalAmount) ? sumCents(percents) / 100 : null
}

/** `sameLocalizedText()` of authorization/localized-text.ts: the same Arabic, English and Turkish texts. */
export function sameLocalizedText(a: LocalizedLabel, b: LocalizedLabel): boolean {
  return a.ar === b.ar && (a.en ?? null) === (b.en ?? null) && (a.tr ?? null) === (b.tr ?? null)
}

function sameLines(a: readonly FeePlanLine[], b: readonly FeePlanLine[]): boolean {
  return a.length === b.length && a.every((line, index) => sameLocalizedText(line.description, b[index]!.description) && toCents(line.amount) === toCents(b[index]!.amount))
}

function sameShares(a: readonly FeePlanShare[], b: readonly FeePlanShare[]): boolean {
  return a.length === b.length && a.every((share, index) => toCents(share.percent) === toCents(b[index]!.percent) && share.dueOffsetDays === b[index]!.dueOffsetDays)
}

/** What PATCH can change of a plan (`CurrentPlan` of fee-plans.rules.ts). */
export interface PlanContent {
  name: LocalizedLabel
  courseId: string | null
  classId: string | null
  lines: FeePlanLine[]
  installments: FeePlanShare[]
}

/** The fields of `next` that differ from `current`, in the server's order — the smallest PATCH (`planFeePlanUpdate()`). */
export function changedPlanFields(current: PlanContent, next: PlanContent): Array<keyof PlanContent> {
  const fields: Array<keyof PlanContent> = []
  if (!sameLocalizedText(current.name, next.name)) fields.push('name')
  if (current.courseId !== next.courseId) fields.push('courseId')
  if (current.classId !== next.classId) fields.push('classId')
  if (!sameLines(current.lines, next.lines)) fields.push('lines')
  if (!sameShares(current.installments, next.installments)) fields.push('installments')
  return fields
}
