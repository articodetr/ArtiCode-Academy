// Fee plans (MOD-11-T02 — owner decision D-R60): API-140 GET /api/fee-plans
// (`fee_plans.manage` or `invoices.manage` — the active plans; inactive ones
// and the invoice count of each for `fee_plans.manage` only), API-141 POST,
// API-142 PATCH /:id and API-143 DELETE /:id (`fee_plans.manage`). A plan is a
// template an invoice copies: localized name, a course or a class or nothing in
// particular, 1..50 lines and 1..24 installment shares (percent of the total
// and days after the day an invoice is created from it). Types mirror
// backend/src/finance/fee-plans.dto.ts field by field; every call goes through
// apiRequest (Bearer header, refresh-and-retry on 401). The plan rules the
// server checks are mirrored in finance/feePlans.rules.ts.
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

/** `FEE_PLAN_LINES_MAX` / `FEE_PLAN_INSTALLMENTS_MAX` of fee-plans.dto.ts (an invoice takes the same bounds). */
export const FEE_PLAN_LINES_MAX = 50
export const FEE_PLAN_INSTALLMENTS_MAX = 24
/** The largest amount numeric(12,2) holds (`MONEY_MAX`). */
export const MONEY_MAX = 9_999_999_999.99
/** `DUE_OFFSET_DAYS_MAX`: a share falls due 0..3650 days after the invoice is created from the plan. */
export const DUE_OFFSET_DAYS_MAX = 3650
/** `LOCALIZED_TEXT_MAX_LENGTH` of LocalizedTextDto (the plan name and every line description). */
export const FINANCE_TEXT_MAX_LENGTH = 200

/** `FeePlanRefDto`: the course or the class a plan prices. */
export interface FeePlanRef {
  id: string
  code: string
  name: LocalizedLabel
}

/** `FeePlanLineOutDto` (and the body's `FeePlanLineDto`): what is charged and how much, in the academy currency. */
export interface FeePlanLine {
  description: LocalizedLabel
  /** A JSON number with at most two decimals, 0.01..MONEY_MAX. */
  amount: number
}

/** `FeePlanShareOutDto` (and `FeePlanShareDto`): a share of the total, due some days after the invoice is created. */
export interface FeePlanShare {
  /** 0.01..100 with at most two decimals; the shares of a plan sum to exactly 100. */
  percent: number
  /** 0..3650, never below the previous share's. */
  dueOffsetDays: number
}

/** `FeePlanDto`. */
export interface FeePlan {
  id: string
  name: LocalizedLabel
  /** The course the plan prices (null with a class or a general plan). */
  course: FeePlanRef | null
  /** The class the plan prices (null with a course or a general plan). */
  class: FeePlanRef | null
  lines: FeePlanLine[]
  installments: FeePlanShare[]
  /** The sum of the lines, computed by the server (no currency: invoices take the academy's — D-R59). */
  total: number
  /** An inactive plan creates no invoice (a used plan is deactivated, never deleted). */
  isActive: boolean
  /** Invoices created from the plan — for `fee_plans.manage` only, else null. */
  invoiceCount: number | null
  createdAt: string
  updatedAt: string
}

/** `FeePlanListDto`: in creation order, no pagination (an academy holds few plans). */
export interface FeePlanList {
  items: FeePlan[]
}

/** `ListFeePlansQueryDto`. */
export interface ListFeePlansParams {
  courseId?: string
  classId?: string
}

/** Body of API-141 (`CreateFeePlanDto`): a course or a class, not both; absent = a general plan. */
export interface CreateFeePlanInput {
  name: LocalizedLabel
  courseId?: string
  classId?: string
  lines: FeePlanLine[]
  installments: FeePlanShare[]
}

/**
 * Body of API-142 (`UpdateFeePlanDto`): absent = unchanged; `null` clears the
 * course or the class; `name`, `lines` and `installments` are replaced whole;
 * `isActive` is a JSON boolean. Invoices already created keep their copy.
 */
export interface UpdateFeePlanInput {
  name?: LocalizedLabel
  courseId?: string | null
  classId?: string | null
  lines?: FeePlanLine[]
  installments?: FeePlanShare[]
  isActive?: boolean
}

export const FEE_PLANS_PATH = '/api/fee-plans'

const feePlanPath = (id: string) => `${FEE_PLANS_PATH}/${encodeURIComponent(id)}`

/** `/api/fee-plans?…` with the given filters only. */
export function feePlansPath(params: ListFeePlansParams = {}): string {
  const query = new URLSearchParams()
  if (params.courseId) query.set('courseId', params.courseId)
  if (params.classId) query.set('classId', params.classId)
  const search = query.toString()
  return search ? `${FEE_PLANS_PATH}?${search}` : FEE_PLANS_PATH
}

/** API-140: `403 permission_denied { missing: [fee_plans.manage, invoices.manage] }` without either key. */
export function listFeePlans(params: ListFeePlansParams = {}, signal?: AbortSignal): Promise<FeePlanList> {
  return apiRequest<FeePlanList>(feePlansPath(params), { signal })
}

/** API-141 (201). */
export function createFeePlan(input: CreateFeePlanInput): Promise<FeePlan> {
  return apiRequest<FeePlan>(FEE_PLANS_PATH, { method: 'POST', body: input })
}

/** API-142: answers with the plan as stored (no difference = no write, the plan as it is). */
export function updateFeePlan(id: string, input: UpdateFeePlanInput): Promise<FeePlan> {
  return apiRequest<FeePlan>(feePlanPath(id), { method: 'PATCH', body: input })
}

/** API-143: refused for a plan an invoice was created from (`409 fee_plan_in_use { invoiceCount }`); resolves on 204. */
export function deleteFeePlan(id: string): Promise<void> {
  return apiRequest<void>(feePlanPath(id), { method: 'DELETE' })
}
