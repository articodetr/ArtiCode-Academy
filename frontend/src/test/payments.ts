// Fixtures for the payments screens (MOD-11): the shapes of API-144/145
// (`InvoiceSummaryDto`/`InvoiceDto`), API-151/154 (`PaymentDto`) and API-155
// (`MyInvoiceItemDto`) as the backend returns them.
import type { Invoice, InvoiceSummary, MyInvoice } from '../api/invoices'
import type { FeePlan } from '../api/feePlans'
import type { Payment } from '../api/payments'

export const INVOICE_ID = '0193c000-0000-7000-8000-0000000f0001'
export const STUDENT_ID = '0193c000-0000-7000-8000-0000000f0101'
export const PAYMENT_ID = '0193c000-0000-7000-8000-0000000f0201'

/** A cashier (staff by seed): reads invoices through `payments.record`, records payments. */
export const CASHIER_PERMISSIONS = ['payments.record', 'invoices.manage']
/** An accountant who may also reverse payments. */
export const FINANCE_ADMIN_PERMISSIONS = ['invoices.read_all', 'invoices.manage', 'payments.record', 'payments.refund', 'users.read']

export function makeInvoiceSummary(overrides: Partial<InvoiceSummary> = {}): InvoiceSummary {
  return {
    id: INVOICE_ID,
    number: 'INV-2026-00057',
    status: 'issued',
    student: { id: STUDENT_ID, fullName: 'سارة أحمد', displayName: null },
    enrollment: { id: 'enr-1', class: { id: 'cls-1', code: 'PY-A', name: { ar: 'بايثون أ', en: 'Python A' } } },
    feePlan: null,
    currency: 'SAR',
    subtotal: 1200,
    discountAmount: 0,
    discountReason: null,
    total: 1200,
    paid: 600,
    balance: 600,
    paymentState: 'partial',
    overdue: false,
    nextDue: { seq: 2, dueOn: '2026-12-01', remaining: 600 },
    issuedAt: '2026-11-10T09:00:00.000Z',
    issuedBy: { fullName: 'موظف المالية' },
    cancelledAt: null,
    cancelReason: null,
    notes: null,
    createdAt: '2026-11-10T08:00:00.000Z',
    updatedAt: '2026-11-10T09:30:00.000Z',
    ...overrides,
  }
}

export function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    ...makeInvoiceSummary(),
    lines: [{ sortOrder: 0, description: { ar: 'رسوم الدورة', en: 'Course fee' }, amount: 1200 }],
    installments: [
      { seq: 1, amount: 600, dueOn: '2026-11-01', paid: 600, remaining: 0, status: 'paid', overdue: false },
      { seq: 2, amount: 600, dueOn: '2026-12-01', paid: 0, remaining: 600, status: 'unpaid', overdue: false },
    ],
    payments: [
      {
        id: PAYMENT_ID,
        number: 'RCPT-2026-00031',
        amount: 600,
        method: 'cash',
        status: 'completed',
        paidAt: '2026-11-10T09:30:00.000Z',
        reference: null,
        payerName: null,
        recordedBy: { fullName: 'موظف المالية' },
        reversedAt: null,
        reverseReason: null,
      },
    ],
    ...overrides,
  }
}

export function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '0193c000-0000-7000-8000-0000000f0202',
    number: 'RCPT-2026-00032',
    invoice: { id: INVOICE_ID, number: 'INV-2026-00057', status: 'issued', currency: 'SAR', total: 1200, paid: 850, balance: 350, paymentState: 'partial' },
    student: { id: STUDENT_ID, fullName: 'سارة أحمد', displayName: null },
    amount: 250,
    currency: 'SAR',
    method: 'bank_transfer',
    status: 'completed',
    paidAt: '2026-11-14T10:00:00.000Z',
    reference: 'TRX-9',
    payerName: null,
    notes: null,
    recordedBy: { fullName: 'موظف المالية' },
    reversedAt: null,
    reversedBy: null,
    reverseReason: null,
    createdAt: '2026-11-14T10:00:00.000Z',
    ...overrides,
  }
}

export function makeMyInvoice(overrides: Partial<MyInvoice> = {}): MyInvoice {
  const { notes: _notes, issuedBy: _issuedBy, feePlan: _feePlan, payments: _payments, ...rest } = makeInvoice()
  return {
    ...rest,
    payments: [{ id: PAYMENT_ID, number: 'RCPT-2026-00031', amount: 600, method: 'cash', paidAt: '2026-11-10T09:30:00.000Z', reference: null, payerName: null }],
    relation: 'self',
    ...overrides,
  }
}

export const FEE_PLAN_ID = '0193c000-0000-7000-8000-0000000f0301'

/** `FeePlanDto` (API-140..142): a general plan, two shares. */
export function makeFeePlan(overrides: Partial<FeePlan> = {}): FeePlan {
  return {
    id: FEE_PLAN_ID,
    name: { ar: 'رسوم الفصل الدراسي', en: 'Term fees' },
    course: null,
    class: null,
    lines: [{ description: { ar: 'رسوم الدورة', en: 'Course fee' }, amount: 1200 }],
    installments: [
      { percent: 50, dueOffsetDays: 0 },
      { percent: 50, dueOffsetDays: 30 },
    ],
    total: 1200,
    isActive: true,
    invoiceCount: 0,
    createdAt: '2026-11-10T08:00:00.000Z',
    updatedAt: '2026-11-10T08:00:00.000Z',
    ...overrides,
  }
}

/** A fee-plan manager who also writes invoices (and may pick students and classes). */
export const FINANCE_MANAGER_PERMISSIONS = ['fee_plans.manage', 'invoices.manage', 'invoices.read_all', 'payments.record', 'users.read', 'classes.read', 'enrollments.read', 'courses.read']
