// Fixtures for the office's enrollment requests (MOD-19): the shapes of
// API-224/225 as the backend returns them, and the permission sets the tests use.
import type { EnrollmentRequest, EnrollmentRequestList } from '../api/enrollmentRequests'
import type { RequestInvoice } from '../api/catalog'
import { makeEnrollmentStudent } from './enrollments'

export const REQUEST_IDS = ['0193c000-0000-7000-8000-0000000e0001', '0193c000-0000-7000-8000-0000000e0002'] as const
export const REQUEST_INVOICE_ID = '0193c000-0000-7000-8000-0000000e0101'
export const REQUEST_CLASS_ID = '0193c000-0000-7000-8000-0000000e0201'
export const REQUEST_COURSE_ID = '0193c000-0000-7000-8000-0000000e0301'

/** A registrar: approves and rejects, never records money. */
export const REGISTRAR_PERMISSIONS = ['enrollments.read', 'enrollments.manage']
/** The office clerk of the seed (`staff`): requests and payments. */
export const OFFICE_PERMISSIONS = ['enrollments.read', 'enrollments.manage', 'payments.record', 'invoices.manage', 'users.read', 'users.read_contact']

export function makeRequestInvoice(overrides: Partial<RequestInvoice> = {}): RequestInvoice {
  return {
    id: REQUEST_INVOICE_ID,
    number: 'INV-2026-00082',
    status: 'issued',
    total: 1000,
    paid: 0,
    balance: 1000,
    currency: 'SAR',
    issuedAt: '2026-11-19T09:00:00.000Z',
    payments: null,
    ...overrides,
  }
}

/** A self-service request of a paid course, unpaid. */
export function makeEnrollmentRequest(overrides: Partial<EnrollmentRequest> = {}): EnrollmentRequest {
  return {
    id: REQUEST_IDS[0],
    status: 'pending',
    state: 'pending_payment',
    source: 'self',
    requestedAt: '2026-11-19T09:00:00.000Z',
    decidedAt: null,
    rejectionReason: null,
    class: {
      id: REQUEST_CLASS_ID,
      code: 'PY-101-A',
      name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' },
      status: 'open',
      startsOn: '2026-12-01',
      endsOn: null,
      capacity: 20,
      enrolledCount: 5,
      leadTeacher: { fullName: 'خالد المعلم', displayName: null },
    },
    course: { id: REQUEST_COURSE_ID, code: 'PY-101', name: { ar: 'أساسيات بايثون', en: 'Python Basics' }, coverImageUrl: null, pricing: 'paid' },
    payment: { state: 'unpaid', required: true, total: 1000, paid: 0, balance: 1000, currency: 'SAR', invoices: [makeRequestInvoice()] },
    student: makeEnrollmentStudent({ fullName: 'ليلى حسن', email: 'layla@test.local' }),
    allowedActions: ['approve', 'reject'],
    approveBlocker: 'payment_required',
    ...overrides,
  }
}

export function makeRequestList(items: EnrollmentRequest[], pendingCount = items.filter((item) => item.status === 'pending').length, nextCursor: string | null = null): EnrollmentRequestList {
  return { items, nextCursor, pendingCount }
}
