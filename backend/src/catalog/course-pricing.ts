// The price of a course (MOD-19, D-R122) as pure rules shared by the course
// API (MOD-04 PATCH/POST), the catalog reads and the request writer. A course
// is paid exactly when `courses.enrollment_fee_plan_id` is set; the price is
// that fee plan's total in the academy currency (D15) — fee plans carry no
// currency of their own. Only a plan that targets no class can price a
// course: a general plan, or a plan of this very course (a class-level price
// is a later step).
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { Prisma } from '../generated/prisma/client.js';
import { linesTotal } from '../finance/fee-plans.rules.js';
import { readPlanLines, readPlanShares } from '../finance/fee-plans.service.js';

export const COURSE_PLAN_SELECT = {
  id: true,
  name: true,
  isActive: true,
  courseId: true,
  classId: true,
  lines: true,
  installments: true,
} satisfies Prisma.FeePlanSelect;

export type CoursePlanRow = Prisma.FeePlanGetPayload<{ select: typeof COURSE_PLAN_SELECT }>;

export interface CourseFeePlan {
  id: string;
  name: LocalizedText;
  isActive: boolean;
  total: number;
  currency: string;
  installments: number;
}

/** A plan can price a course when it targets no class and either no course or this one. `courseId` null = a course not created yet. */
export function coursePlanFits(plan: Pick<CoursePlanRow, 'courseId' | 'classId'>, courseId: string | null): boolean {
  return plan.classId === null && (plan.courseId === null || plan.courseId === courseId);
}

/** True when a request can be priced now: the plan is active and still fits the course (D-R122). */
export function coursePlanUsable(plan: Pick<CoursePlanRow, 'courseId' | 'classId' | 'isActive'>, courseId: string): boolean {
  return plan.isActive && coursePlanFits(plan, courseId);
}

/** The plan's total as a two-decimal string (the sum of its lines). */
export function coursePlanTotal(plan: Pick<CoursePlanRow, 'lines'>): string {
  return linesTotal(readPlanLines(plan.lines));
}

export function toCourseFeePlan(plan: CoursePlanRow, currency: string): CourseFeePlan {
  return {
    id: plan.id,
    name: readLocalizedText(plan.name) ?? { ar: plan.id },
    isActive: plan.isActive,
    total: Number(coursePlanTotal(plan)),
    currency,
    installments: readPlanShares(plan.installments).length,
  };
}
