// Fee plan and installment rules of MOD-11 (roadmap §4i; owner decisions
// D-R60/D-R62) as pure functions, unit-tested in fee-plans.rules.spec.ts:
//
//   plan      lines with positive amounts (DTO), installment shares summing to
//             exactly 100 with non-decreasing day offsets, a course or a class
//             but not both
//   split     an amount over shares: each installment the share rounded half-up
//             to cents, the remainder on the last (so the parts sum exactly)
//   update    the smallest change of a plan
import type { LocalizedText } from '../authorization/localized-text.js';
import { sameLocalizedText } from '../authorization/localized-text.js';
import { Prisma } from '../generated/prisma/client.js';
import type { FeePlanProblem } from './finance.errors.js';

export interface PlanLine {
  description: LocalizedText;
  /** Two decimals. */
  amount: number;
}

export interface PlanShare {
  /** 0.01..100 with two decimals. */
  percent: number;
  /** Days after the issue date, 0..3650. */
  dueOffsetDays: number;
}

/** Two-decimal text of an amount (numeric(12,2)). */
export function moneyText(value: number | string | Prisma.Decimal): string {
  return new Prisma.Decimal(value).toFixed(2);
}

/** The sum of the lines, two decimals. */
export function linesTotal(lines: readonly { amount: number | string }[]): string {
  return lines.reduce((sum, line) => sum.plus(new Prisma.Decimal(line.amount)), new Prisma.Decimal(0)).toFixed(2);
}

/** The rules a plan breaks (empty = valid). */
export function checkPlan(plan: { courseId: string | null; classId: string | null; installments: readonly PlanShare[] }): FeePlanProblem[] {
  const problems: FeePlanProblem[] = [];
  if (plan.courseId !== null && plan.classId !== null) problems.push('course_and_class');
  const sum = plan.installments.reduce((total, share) => total.plus(new Prisma.Decimal(share.percent)), new Prisma.Decimal(0));
  if (!sum.equals(100)) problems.push('percent_sum');
  if (plan.installments.some((share, index) => index > 0 && share.dueOffsetDays < plan.installments[index - 1]!.dueOffsetDays)) problems.push('offsets_not_ascending');
  return problems;
}

/** `YYYY-MM-DD` plus whole days. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface SplitInstallment {
  seq: number;
  /** Two decimals. */
  amount: string;
  /** `YYYY-MM-DD`. */
  dueOn: string;
}

/** `total` over the shares from `startDay` (D-R60/D-R62): rounded half-up to cents, the remainder on the last. */
export function splitInstallments(total: string, shares: readonly PlanShare[], startDay: string): SplitInstallment[] {
  const whole = new Prisma.Decimal(total);
  let given = new Prisma.Decimal(0);
  return shares.map((share, index) => {
    const last = index === shares.length - 1;
    const amount = last ? whole.minus(given) : whole.times(share.percent).dividedBy(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    given = given.plus(amount);
    return { seq: index + 1, amount: amount.toFixed(2), dueOn: addDays(startDay, share.dueOffsetDays) };
  });
}

/** JSON text with sorted keys — compares stored jsonb with a request. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface CurrentPlan {
  name: LocalizedText;
  courseId: string | null;
  classId: string | null;
  lines: PlanLine[];
  installments: PlanShare[];
  isActive: boolean;
}

export type FeePlanPatch = Partial<CurrentPlan>;
export const FEE_PLAN_PATCH_FIELDS = ['name', 'courseId', 'classId', 'lines', 'installments', 'isActive'] as const;
export type FeePlanField = (typeof FEE_PLAN_PATCH_FIELDS)[number];

/** The fields that change, in the fixed order of the audit metadata, and the merged plan. */
export function planFeePlanUpdate(current: CurrentPlan, patch: FeePlanPatch): { fields: FeePlanField[]; next: CurrentPlan } {
  const next: CurrentPlan = { ...current };
  const fields: FeePlanField[] = [];
  if (patch.name !== undefined && !sameLocalizedText(current.name, patch.name)) {
    next.name = patch.name;
    fields.push('name');
  }
  if (patch.courseId !== undefined && patch.courseId !== current.courseId) {
    next.courseId = patch.courseId;
    fields.push('courseId');
  }
  if (patch.classId !== undefined && patch.classId !== current.classId) {
    next.classId = patch.classId;
    fields.push('classId');
  }
  if (patch.lines !== undefined && canonical(patch.lines) !== canonical(current.lines)) {
    next.lines = patch.lines;
    fields.push('lines');
  }
  if (patch.installments !== undefined && canonical(patch.installments) !== canonical(current.installments)) {
    next.installments = patch.installments;
    fields.push('installments');
  }
  if (patch.isActive !== undefined && patch.isActive !== current.isActive) {
    next.isActive = patch.isActive;
    fields.push('isActive');
  }
  return { fields, next };
}
