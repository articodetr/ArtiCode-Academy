// What a printed receipt shows (J-F52 — D-R63), from either reading: the
// office's receipt (API-153 — the payment with its invoice as it stands now and
// its recorder) or the owner's (API-155 — a completed payment of one of their
// invoices, without the recorder or the note). The internal note is never
// printed. No React.
import type { MyInvoiceItem, MyInvoicePayment } from '../api/myInvoices'
import type { Payment, PaymentMethod, PaymentStatus } from '../api/payments'

export interface ReceiptData {
  /** `RCPT-YYYY-NNNNN` */
  number: string
  status: PaymentStatus
  amount: number
  currency: string
  method: PaymentMethod
  paidAt: string
  reference: string | null
  payerName: string | null
  studentName: string
  /** `INV-YYYY-NNNNN` (a payment is recorded on an issued invoice, which keeps its number). */
  invoiceNumber: string | null
  /** The invoice's numbers as the server sent them with the reading (now — not at the payment's time). */
  invoiceTotal: number
  invoicePaid: number
  invoiceBalance: number
  /** The office's reading only. */
  recordedBy: string | null
  reversedAt: string | null
  reverseReason: string | null
}

function personName(person: { fullName: string; displayName: string | null }): string {
  return person.displayName?.trim() || person.fullName
}

/** The office's receipt (API-153). */
export function receiptOfPayment(payment: Payment): ReceiptData {
  return {
    number: payment.number,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    paidAt: payment.paidAt,
    reference: payment.reference,
    payerName: payment.payerName,
    studentName: personName(payment.student),
    invoiceNumber: payment.invoice.number,
    invoiceTotal: payment.invoice.total,
    invoicePaid: payment.invoice.paid,
    invoiceBalance: payment.invoice.balance,
    recordedBy: payment.recordedBy?.fullName ?? null,
    reversedAt: payment.reversedAt,
    reverseReason: payment.reverseReason,
  }
}

/** The owner's receipt (API-155): a valid (completed) payment of one of their invoices. */
export function receiptOfMyInvoice(invoice: MyInvoiceItem, payment: MyInvoicePayment): ReceiptData {
  return {
    number: payment.number,
    status: 'completed',
    amount: payment.amount,
    currency: invoice.currency,
    method: payment.method,
    paidAt: payment.paidAt,
    reference: payment.reference,
    payerName: payment.payerName,
    studentName: personName(invoice.student),
    invoiceNumber: invoice.number,
    invoiceTotal: invoice.total,
    invoicePaid: invoice.paid,
    invoiceBalance: invoice.balance,
    recordedBy: null,
    reversedAt: null,
    reverseReason: null,
  }
}

/** The owner's invoice and payment of a receipt id, or null (a reversed receipt or someone else's is not in API-155). */
export function findMyReceipt(items: readonly MyInvoiceItem[], paymentId: string): { invoice: MyInvoiceItem; payment: MyInvoicePayment } | null {
  for (const invoice of items) {
    const payment = invoice.payments.find((candidate) => candidate.id === paymentId)
    if (payment) return { invoice, payment }
  }
  return null
}
