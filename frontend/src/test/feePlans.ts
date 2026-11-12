// Fixtures for the fee plans tab (MOD-11 — J-F52): the shape of API-140..API-143
// as backend/src/finance/fee-plans.service.ts returns it, plus the permission
// sets of the seeded roles that touch fee plans and invoices
// (backend/src/authorization/system-roles.ts).
import type { FeePlan, FeePlanList } from '../api/feePlans'
import { CLASS_COURSE_ID, CLASS_ID } from './classes'

export const FEE_PLAN_IDS = ['0195f000-0000-7000-8000-00000000a101', '0195f000-0000-7000-8000-00000000a102', '0195f000-0000-7000-8000-00000000a103'] as const

/** academy_admin by seed: every finance key, and the pickers of the forms. */
export const FINANCE_ADMIN_PERMISSIONS = [
  'fee_plans.manage',
  'invoices.read_all',
  'invoices.manage',
  'payments.record',
  'payments.refund',
  'classes.read',
  'classes.manage',
  'enrollments.read',
  'enrollments.manage',
  'users.read',
  'courses.read',
]

/** staff by seed: plans, invoices and payments without reading every invoice by key or reversing a payment. */
export const FINANCE_STAFF_PERMISSIONS = ['fee_plans.manage', 'invoices.manage', 'payments.record', 'classes.read', 'classes.manage', 'enrollments.read', 'enrollments.manage', 'users.read', 'courses.read']

/** A custom «invoicing» role: invoices.manage without fee_plans.manage — reads the active plans only. */
export const INVOICE_MANAGER_PERMISSIONS = ['invoices.manage', 'classes.read', 'enrollments.read', 'users.read']

/** A custom cashier: records payments, reads invoices and receipts through that key alone. */
export const CASHIER_PERMISSIONS = ['payments.record']

/** A custom auditor: reads every invoice and receipt, writes nothing. */
export const FINANCE_READER_PERMISSIONS = ['invoices.read_all']

/** A plan for one class: 1000 + 200, half today and half 30 days later — the acceptance journey's plan (§4i.9). */
export function makeFeePlan(overrides: Partial<FeePlan> = {}): FeePlan {
  return {
    id: FEE_PLAN_IDS[0],
    name: { ar: 'رسوم بايثون — الفصل أ', en: 'Python fees — class A' },
    course: null,
    class: { id: CLASS_ID, code: 'PY-101-A', name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' } },
    lines: [
      { description: { ar: 'رسوم الدورة', en: 'Course fee' }, amount: 1000 },
      { description: { ar: 'رسوم المواد' }, amount: 200 },
    ],
    installments: [
      { percent: 50, dueOffsetDays: 0 },
      { percent: 50, dueOffsetDays: 30 },
    ],
    total: 1200,
    isActive: true,
    invoiceCount: 1,
    createdAt: '2026-11-10T20:00:00.000Z',
    updatedAt: '2026-11-10T20:00:00.000Z',
    ...overrides,
  }
}

/** A plan for every class of the course, unused. */
export function makeCoursePlan(overrides: Partial<FeePlan> = {}): FeePlan {
  return makeFeePlan({
    id: FEE_PLAN_IDS[1],
    name: { ar: 'رسوم دورة بايثون' },
    course: { id: CLASS_COURSE_ID, code: 'PY-101', name: { ar: 'أساسيات بايثون', en: 'Python Basics' } },
    class: null,
    lines: [{ description: { ar: 'رسوم الدورة' }, amount: 900 }],
    installments: [{ percent: 100, dueOffsetDays: 0 }],
    total: 900,
    invoiceCount: 0,
    ...overrides,
  })
}

/** A plan of another class, inactive and used — what only fee_plans.manage reads. */
export function makeInactivePlan(overrides: Partial<FeePlan> = {}): FeePlan {
  return makeFeePlan({
    id: FEE_PLAN_IDS[2],
    name: { ar: 'رسوم قديمة' },
    course: null,
    class: { id: '0195f000-0000-7000-8000-00000000c999', code: 'JS-201-B', name: { ar: 'جافاسكربت — ب' } },
    lines: [{ description: { ar: 'رسوم' }, amount: 300 }],
    installments: [{ percent: 100, dueOffsetDays: 0 }],
    total: 300,
    isActive: false,
    invoiceCount: 4,
    ...overrides,
  })
}

/** The three plans as fee_plans.manage reads them (creation order). */
export function threeFeePlans(): FeePlan[] {
  return [makeFeePlan(), makeCoursePlan(), makeInactivePlan()]
}

export function makeFeePlanList(items: FeePlan[] = threeFeePlans()): FeePlanList {
  return { items }
}
