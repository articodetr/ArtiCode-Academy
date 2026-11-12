// Fixtures for the invoices tab and the invoice drawer (MOD-11 — J-F52): the
// shapes of API-144..API-150 as backend/src/finance/invoices.service.ts returns
// them — the paid parts, balance, payment state, overdue and next installment
// as the server computes them (ADR-068), never recomputed by a screen. The
// issued invoice is the acceptance journey's (§4i.9): 1200 in two installments,
// 600 paid in cash (RCPT-2026-00031) and 400 by transfer reversed
// (RCPT-2026-00032).
import type { ClassInvoicesResult, Invoice, InvoiceList, InvoiceSummary } from '../api/invoices'
import { CLASS_ID } from './classes'
import { ENROLLMENT_IDS, STUDENT_IDS } from './enrollments'
import { FEE_PLAN_IDS } from './feePlans'

export const INVOICE_IDS = ['0195f000-0000-7000-8000-00000000b201', '0195f000-0000-7000-8000-00000000b202', '0195f000-0000-7000-8000-00000000b203'] as const
export const INVOICE_PAYMENT_IDS = ['0195f000-0000-7000-8000-00000000c301', '0195f000-0000-7000-8000-00000000c302'] as const

export const FINANCE_STUDENT = { id: STUDENT_IDS[0], fullName: 'عمر خالد', displayName: null }

/** The issued invoice INV-2026-00057: 1200 SAR, 600 paid, the second installment of 600 due next. */
export function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: INVOICE_IDS[0],
    number: 'INV-2026-00057',
    status: 'issued',
    student: FINANCE_STUDENT,
    enrollment: { id: ENROLLMENT_IDS[0], class: { id: CLASS_ID, code: 'PY-101-A', name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' } } },
    feePlan: { id: FEE_PLAN_IDS[0], name: { ar: 'رسوم بايثون — الفصل أ', en: 'Python fees — class A' } },
    currency: 'SAR',
    subtotal: 1200,
    discountAmount: 0,
    discountReason: null,
    total: 1200,
    paid: 600,
    balance: 600,
    paymentState: 'partial',
    overdue: false,
    nextDue: { seq: 2, dueOn: '2026-12-11', remaining: 600 },
    issuedAt: '2026-11-11T02:06:30.000Z',
    issuedBy: { fullName: 'مدير الاختبار' },
    cancelledAt: null,
    cancelReason: null,
    notes: 'تُحصَّل في المكتب',
    createdAt: '2026-11-11T02:06:30.000Z',
    updatedAt: '2026-11-11T02:06:31.000Z',
    lines: [
      { sortOrder: 0, description: { ar: 'رسوم الدورة', en: 'Course fee' }, amount: 1000 },
      { sortOrder: 1, description: { ar: 'رسوم المواد' }, amount: 200 },
    ],
    installments: [
      { seq: 1, amount: 600, dueOn: '2026-11-11', paid: 600, remaining: 0, status: 'paid', overdue: false },
      { seq: 2, amount: 600, dueOn: '2026-12-11', paid: 0, remaining: 600, status: 'unpaid', overdue: false },
    ],
    payments: [
      {
        id: INVOICE_PAYMENT_IDS[1],
        number: 'RCPT-2026-00032',
        amount: 400,
        method: 'bank_transfer',
        status: 'reversed',
        paidAt: '2026-11-11T02:06:31.000Z',
        reference: 'TRX-778',
        payerName: null,
        recordedBy: { fullName: 'مدير الاختبار' },
        reversedAt: '2026-11-11T02:06:31.500Z',
        reverseReason: 'تحويل مكرر',
      },
      {
        id: INVOICE_PAYMENT_IDS[0],
        number: 'RCPT-2026-00031',
        amount: 600,
        method: 'cash',
        status: 'completed',
        paidAt: '2026-11-11T02:06:30.500Z',
        reference: null,
        payerName: 'خالد عمر',
        recordedBy: { fullName: 'مدير الاختبار' },
        reversedAt: null,
        reverseReason: null,
      },
    ],
    ...overrides,
  }
}

/** A draft by hand: 300 in one installment, no number, nothing paid (no next installment until it is issued). */
export function makeDraftInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return makeInvoice({
    id: INVOICE_IDS[1],
    number: null,
    status: 'draft',
    feePlan: null,
    subtotal: 300,
    total: 300,
    paid: 0,
    balance: 300,
    paymentState: 'unpaid',
    nextDue: null,
    issuedAt: null,
    issuedBy: null,
    notes: null,
    lines: [{ sortOrder: 0, description: { ar: 'رسوم التسجيل', en: 'Registration fee' }, amount: 300 }],
    installments: [{ seq: 1, amount: 300, dueOn: '2026-11-20', paid: 0, remaining: 300, status: 'unpaid', overdue: false }],
    payments: [],
    createdAt: '2026-11-11T02:07:00.000Z',
    updatedAt: '2026-11-11T02:07:00.000Z',
    ...overrides,
  })
}

/** An issued invoice with no payment and its first installment past due — overdue, as the server says. */
export function makeOverdueInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return makeInvoice({
    id: INVOICE_IDS[2],
    number: 'INV-2026-00058',
    paid: 0,
    balance: 1200,
    paymentState: 'unpaid',
    overdue: true,
    nextDue: { seq: 1, dueOn: '2026-10-01', remaining: 600 },
    installments: [
      { seq: 1, amount: 600, dueOn: '2026-10-01', paid: 0, remaining: 600, status: 'unpaid', overdue: true },
      { seq: 2, amount: 600, dueOn: '2026-11-01', paid: 0, remaining: 600, status: 'unpaid', overdue: true },
    ],
    payments: [],
    ...overrides,
  })
}

/** The list item of an invoice (API-144): the detail without its lines, installments and payments. */
export function summaryOf(invoice: Invoice): InvoiceSummary {
  const { lines: _lines, installments: _installments, payments: _payments, ...summary } = invoice
  void _lines
  void _installments
  void _payments
  return summary
}

export function makeInvoiceList(items: Invoice[], nextCursor: string | null = null): InvoiceList {
  return { items: items.map(summaryOf), nextCursor }
}

/** API-150's answer: `created` (summaries) and `skipped`. */
export function makeClassInvoicesResult(overrides: Partial<ClassInvoicesResult> = {}): ClassInvoicesResult {
  return { created: [], skipped: [], ...overrides }
}
