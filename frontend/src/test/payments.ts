// Fixtures for the receipts tab and the receipt page (MOD-11 — J-F52): the shape
// of API-151..API-154 as backend/src/finance/payments.service.ts returns it —
// each receipt with its invoice as it stands now (the server's numbers).
import type { Payment, PaymentList } from '../api/payments'
import { FINANCE_STUDENT, INVOICE_IDS, INVOICE_PAYMENT_IDS } from './invoices'

/** The cash receipt RCPT-2026-00031 of INV-2026-00057 (600 of 1200 paid). */
export function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: INVOICE_PAYMENT_IDS[0],
    number: 'RCPT-2026-00031',
    invoice: { id: INVOICE_IDS[0], number: 'INV-2026-00057', status: 'issued', currency: 'SAR', total: 1200, paid: 600, balance: 600, paymentState: 'partial' },
    student: FINANCE_STUDENT,
    amount: 600,
    currency: 'SAR',
    method: 'cash',
    status: 'completed',
    paidAt: '2026-11-11T02:06:30.500Z',
    reference: null,
    payerName: 'خالد عمر',
    notes: 'سُلّمت للمحاسب',
    recordedBy: { fullName: 'مدير الاختبار' },
    reversedAt: null,
    reversedBy: null,
    reverseReason: null,
    createdAt: '2026-11-11T02:06:30.500Z',
    ...overrides,
  }
}

/** The transfer receipt RCPT-2026-00032, reversed. */
export function makeReversedPayment(overrides: Partial<Payment> = {}): Payment {
  return makePayment({
    id: INVOICE_PAYMENT_IDS[1],
    number: 'RCPT-2026-00032',
    amount: 400,
    method: 'bank_transfer',
    status: 'reversed',
    reference: 'TRX-778',
    payerName: null,
    notes: null,
    reversedAt: '2026-11-11T02:06:31.500Z',
    reversedBy: { fullName: 'مدير الاختبار' },
    reverseReason: 'تحويل مكرر',
    createdAt: '2026-11-11T02:06:31.000Z',
    ...overrides,
  })
}

export function makePaymentList(items: Payment[], nextCursor: string | null = null): PaymentList {
  return { items, nextCursor }
}
