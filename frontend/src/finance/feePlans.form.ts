// The fee plan editor's values (J-F52 — API-141/142) and their way to the
// server: the create body, the smallest PATCH (no request when nothing changed —
// the mirror of `planFeePlanUpdate()` in feePlans.rules.ts) and the unsaved-work
// test, which compares what the form holds with what it started from the way
// the planner does (trimmed texts, amounts in cents), so a change changed back
// holds nothing and an emptied required field holds something. No React.
import { DUE_OFFSET_DAYS_MAX } from '../api/feePlans'
import type { CreateFeePlanInput, FeePlan, FeePlanLine, FeePlanShare, UpdateFeePlanInput } from '../api/feePlans'
import type { LocalizedLabel } from '../api/users'
import { evenSplitCents, fromCents, isPositiveAmount, isSharePercent, isWholeDays, toCents } from './finance.money'
import { feePlanScopeOf } from './finance.format'
import type { FeePlanScope } from './finance.format'
import { PERCENT_TOTAL_CENTS, changedPlanFields, checkPlan } from './feePlans.rules'
import type { FeePlanProblem, PlanContent } from './feePlans.rules'

/** A line in the editor: the Turkish text is kept, not shown. */
export interface PlanLineFormValues {
  descriptionAr?: string
  descriptionEn?: string
  descriptionTr?: string
  amount?: number | null
}

export interface PlanShareFormValues {
  percent?: number | null
  dueOffsetDays?: number | null
}

export interface FeePlanFormValues {
  nameAr?: string
  nameEn?: string
  /** Kept as the plan holds it (the form does not show it). */
  nameTr?: string
  scope?: FeePlanScope
  courseId?: string
  classId?: string
  lines?: PlanLineFormValues[]
  installments?: PlanShareFormValues[]
}

const text = (value: string | undefined | null) => (value ?? '').trim()

/** `{ ar, en?, tr? }` from three inputs: trimmed, the blank optional locales dropped (`toLocalizedText()`). */
export function localizedOf(ar: string | undefined, en: string | undefined, tr: string | undefined): LocalizedLabel {
  const label: LocalizedLabel = { ar: text(ar) }
  if (text(en)) label.en = text(en)
  if (text(tr)) label.tr = text(tr)
  return label
}

export function emptyPlanLine(): PlanLineFormValues {
  return { descriptionAr: '', descriptionEn: '', descriptionTr: '', amount: null }
}

/** A new plan: general, one line to fill, one share of 100% due the day the invoice is created. */
export function newFeePlanForm(): FeePlanFormValues {
  return { nameAr: '', nameEn: '', nameTr: '', scope: 'general', lines: [emptyPlanLine()], installments: [{ percent: 100, dueOffsetDays: 0 }] }
}

export function feePlanFormValuesOf(plan: FeePlan): FeePlanFormValues {
  return {
    nameAr: plan.name.ar,
    nameEn: plan.name.en ?? '',
    nameTr: plan.name.tr ?? '',
    scope: feePlanScopeOf(plan),
    courseId: plan.course?.id,
    classId: plan.class?.id,
    lines: plan.lines.map((line) => ({ descriptionAr: line.description.ar, descriptionEn: line.description.en ?? '', descriptionTr: line.description.tr ?? '', amount: line.amount })),
    installments: plan.installments.map((share) => ({ percent: share.percent, dueOffsetDays: share.dueOffsetDays })),
  }
}

/** The plan the form describes (call once the fields are valid). */
export function planContentOf(values: FeePlanFormValues): PlanContent {
  const scope = values.scope ?? 'general'
  return {
    name: localizedOf(values.nameAr, values.nameEn, values.nameTr),
    courseId: scope === 'course' ? (values.courseId ?? null) : null,
    classId: scope === 'class' ? (values.classId ?? null) : null,
    lines: (values.lines ?? []).map(
      (line): FeePlanLine => ({ description: localizedOf(line.descriptionAr, line.descriptionEn, line.descriptionTr), amount: line.amount as number }),
    ),
    installments: (values.installments ?? []).map((share): FeePlanShare => ({ percent: share.percent as number, dueOffsetDays: share.dueOffsetDays as number })),
  }
}

/** Body of API-141: the course or the class only for its scope. */
export function buildCreateFeePlanInput(values: FeePlanFormValues): CreateFeePlanInput {
  const content = planContentOf(values)
  const input: CreateFeePlanInput = { name: content.name, lines: content.lines, installments: content.installments }
  if (content.courseId) input.courseId = content.courseId
  if (content.classId) input.classId = content.classId
  return input
}

function contentOfPlan(plan: FeePlan): PlanContent {
  return { name: plan.name, courseId: plan.course?.id ?? null, classId: plan.class?.id ?? null, lines: plan.lines, installments: plan.installments }
}

/** The smallest PATCH of API-142 (whole lines/shares when they differ), or null when nothing changed. */
export function planFeePlanPatch(plan: FeePlan, values: FeePlanFormValues): UpdateFeePlanInput | null {
  const next = planContentOf(values)
  const fields = changedPlanFields(contentOfPlan(plan), next)
  if (fields.length === 0) return null
  const patch: UpdateFeePlanInput = {}
  for (const field of fields) {
    if (field === 'name') patch.name = next.name
    if (field === 'courseId') patch.courseId = next.courseId
    if (field === 'classId') patch.classId = next.classId
    if (field === 'lines') patch.lines = next.lines
    if (field === 'installments') patch.installments = next.installments
  }
  return patch
}

/** The form's values as the planner reads them: trimmed texts, the scope's target only, amounts and percents in cents. */
function normalised(values: FeePlanFormValues): string {
  const scope = values.scope ?? 'general'
  const cents = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? toCents(value) : null)
  return JSON.stringify({
    name: [text(values.nameAr), text(values.nameEn), text(values.nameTr)],
    scope,
    target: scope === 'course' ? (values.courseId ?? null) : scope === 'class' ? (values.classId ?? null) : null,
    lines: (values.lines ?? []).map((line) => [text(line.descriptionAr), text(line.descriptionEn), text(line.descriptionTr), cents(line.amount)]),
    installments: (values.installments ?? []).map((share) => [cents(share.percent), share.dueOffsetDays ?? null]),
  })
}

/** Whether the editor holds unsaved work: what it holds differs from what it started with. */
export function feePlanFormHasChanges(initial: FeePlanFormValues, values: FeePlanFormValues): boolean {
  return normalised(initial) !== normalised(values)
}

/** The plan rules the form's shares break, once every share is a valid number (else their own fields speak). */
export function feePlanFormProblems(values: FeePlanFormValues): FeePlanProblem[] {
  const shares = values.installments ?? []
  if (shares.length === 0 || !shares.every((share) => isSharePercent(share.percent) && isWholeDays(share.dueOffsetDays, DUE_OFFSET_DAYS_MAX))) return []
  return checkPlan({ courseId: null, classId: null, installments: shares as FeePlanShare[] })
}

/** The sum of the lines in cents, or null while a line amount is not valid — the editor's running total. */
export function planLinesTotalCents(values: FeePlanFormValues): number | null {
  const lines = values.lines ?? []
  return lines.every((line) => isPositiveAmount(line.amount)) ? lines.reduce((sum, line) => sum + toCents(line.amount as number), 0) : null
}

/** `count` shares of 100% split evenly, the remainder on the last, keeping the offsets the form already holds. */
export function evenShares(shares: readonly PlanShareFormValues[]): PlanShareFormValues[] {
  const parts = evenSplitCents(PERCENT_TOTAL_CENTS, shares.length)
  return shares.map((share, index) => ({ ...share, percent: fromCents(parts[index]!) }))
}
