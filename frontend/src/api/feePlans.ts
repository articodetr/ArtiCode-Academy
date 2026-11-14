// Fee plans (MOD-11-T02): API-140..API-143. Types mirror
// backend/src/finance/fee-plans.dto.ts. Reading needs `fee_plans.manage` or
// `invoices.manage` (either — `missingAny()` of finance.policy.ts); inactive
// plans and the invoice counts come only with `fee_plans.manage`. Writing needs
// `fee_plans.manage`. A plan is a template (D-R60): lines and installment shares
// that sum to 100 with non-decreasing day offsets; a course or a class, not both.
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

/** `FEE_PLAN_LINES_MAX`, `FEE_PLAN_INSTALLMENTS_MAX`, `DUE_OFFSET_DAYS_MAX` of fee-plans.dto.ts. */
export const FEE_PLAN_LINES_MAX = 50
export const FEE_PLAN_INSTALLMENTS_MAX = 24
export const DUE_OFFSET_DAYS_MAX = 3650

/** Reading keys (either suffices) and the writing key. */
export const FEE_PLAN_READ_PERMISSIONS = ['fee_plans.manage', 'invoices.manage'] as const
export const FEE_PLANS_MANAGE_PERMISSION = 'fee_plans.manage'

export interface FeePlanRef {
  id: string
  code: string
  name: LocalizedLabel
}

export interface FeePlanLine {
  description: LocalizedLabel
  amount: number
}

export interface FeePlanShare {
  percent: number
  dueOffsetDays: number
}

/** `FeePlanDto`. */
export interface FeePlan {
  id: string
  name: LocalizedLabel
  course: FeePlanRef | null
  class: FeePlanRef | null
  lines: FeePlanLine[]
  installments: FeePlanShare[]
  /** The sum of the lines. */
  total: number
  isActive: boolean
  /** For `fee_plans.manage` only, else null. */
  invoiceCount: number | null
  createdAt: string
  updatedAt: string
}

/** Body of API-141. */
export interface CreateFeePlanInput {
  name: LocalizedLabel
  courseId?: string
  classId?: string
  lines: FeePlanLine[]
  installments: FeePlanShare[]
}

/** Body of API-142: absent = unchanged, `null` clears the course or the class; lines and installments are replaced whole. */
export interface UpdateFeePlanInput {
  name?: LocalizedLabel
  courseId?: string | null
  classId?: string | null
  lines?: FeePlanLine[]
  installments?: FeePlanShare[]
  isActive?: boolean
}

export interface ListFeePlansParams {
  courseId?: string
  classId?: string
}

export const FEE_PLANS_PATH = '/api/fee-plans'
export const feePlanPath = (id: string) => `${FEE_PLANS_PATH}/${encodeURIComponent(id)}`

export function feePlansListPath(params: ListFeePlansParams = {}): string {
  const query = new URLSearchParams()
  if (params.courseId) query.set('courseId', params.courseId)
  if (params.classId) query.set('classId', params.classId)
  const search = query.toString()
  return search ? `${FEE_PLANS_PATH}?${search}` : FEE_PLANS_PATH
}

/** API-140: active plans (inactive ones too for `fee_plans.manage`), no pagination. */
export function listFeePlans(params: ListFeePlansParams = {}, signal?: AbortSignal): Promise<{ items: FeePlan[] }> {
  return apiRequest<{ items: FeePlan[] }>(feePlansListPath(params), { signal })
}

/** API-141. */
export function createFeePlan(input: CreateFeePlanInput): Promise<FeePlan> {
  return apiRequest<FeePlan>(FEE_PLANS_PATH, { method: 'POST', body: input })
}

/** API-142. */
export function updateFeePlan(id: string, input: UpdateFeePlanInput): Promise<FeePlan> {
  return apiRequest<FeePlan>(feePlanPath(id), { method: 'PATCH', body: input })
}

/** API-143: only a plan no invoice was created from (`409 fee_plan_in_use { invoiceCount }` — deactivate it instead). */
export function deleteFeePlan(id: string): Promise<void> {
  return apiRequest<void>(feePlanPath(id), { method: 'DELETE' })
}
