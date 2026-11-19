// MOD-19 — the pure rules of the requests page: the reason and search limits,
// and the mapping of the server's refusals (catalog.errors.ts + MOD-05 codes).
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { unpaidInvoicesOf } from '../classes/classes.errors'
import { describeRequestsFailure, isGoneRequest, isStaleRequest } from './requests.errors'
import { DEFAULT_REQUEST_STATE, REQUEST_STATE_FILTERS, rejectionReasonOf, requestSearchOf } from './requests.format'

const refusal = (status: number, code: string, details: Record<string, unknown> = {}) =>
  new ApiError(status, code, { statusCode: status, code, message: code, ...details })

describe('requests.format', () => {
  it('trims a rejection reason and refuses a blank or too long one (D-R126, ck_enrollments_rejection_reason_text)', () => {
    expect(rejectionReasonOf('  مستوى غير مناسب ')).toBe('مستوى غير مناسب')
    expect(rejectionReasonOf('   ')).toBeNull()
    expect(rejectionReasonOf(undefined)).toBeNull()
    expect(rejectionReasonOf('x'.repeat(500))).toHaveLength(500)
    expect(rejectionReasonOf('x'.repeat(501))).toBeNull()
  })

  it('sends a trimmed search of at most 100 characters, blank as absent; opens on the pending requests like the server', () => {
    expect(requestSearchOf('  ليلى ')).toBe('ليلى')
    expect(requestSearchOf('   ')).toBeUndefined()
    expect(requestSearchOf('a'.repeat(120))).toHaveLength(100)
    expect(DEFAULT_REQUEST_STATE).toBe('pending')
    expect(REQUEST_STATE_FILTERS).toEqual(['pending', 'pending_payment', 'pending_approval', 'approved', 'rejected', 'cancelled', 'all'])
  })
})

describe('requests.errors', () => {
  it('names the unpaid invoices of payment_required as the server sends them', () => {
    const failure = describeRequestsFailure(
      refusal(409, 'payment_required', { paymentState: 'partial', invoices: [{ id: 'i1', number: 'INV-2026-00082', balance: 600 }, { id: 'i2', number: null, balance: 50.5 }] }),
    )
    expect(failure).toEqual({ key: 'enrollmentRequests.errors.payment_required', params: { invoices: 'INV-2026-00082: 600.00, —: 50.50' } })
    expect(isStaleRequest(failure)).toBe(true)
    expect(unpaidInvoicesOf('nope')).toBe('')
  })

  it('maps the other MOD-19 and MOD-05 codes with their details, and tells stale and gone requests apart', () => {
    const hasPayments = describeRequestsFailure(refusal(409, 'request_has_payments', { paymentCount: 2 }))
    expect(hasPayments).toEqual({ key: 'enrollmentRequests.errors.request_has_payments', params: { paymentCount: '2' } })
    const full = describeRequestsFailure(refusal(409, 'class_full', { capacity: 20, enrolledCount: 20 }))
    expect(full.params).toEqual({ capacity: '20', enrolledCount: '20' })
    expect(isStaleRequest(full)).toBe(true)
    const gone = describeRequestsFailure(refusal(404, 'request_not_found'))
    expect(isGoneRequest(gone)).toBe(true)
    expect(isStaleRequest(gone)).toBe(false)
    expect(describeRequestsFailure(refusal(400, 'rejection_reason_required')).key).toBe('enrollmentRequests.errors.rejection_reason_required')
    expect(describeRequestsFailure(refusal(403, 'permission_denied', { missing: ['enrollments.manage'] }))).toEqual({
      key: 'enrollmentRequests.errors.permission_denied',
      params: { list: '(enrollments.manage)' },
    })
    expect(describeRequestsFailure(new ApiError(400, 'reason must be shorter'))).toEqual({ key: 'enrollmentRequests.errors.validation', params: { message: 'reason must be shorter' } })
    expect(describeRequestsFailure(new ApiError(503, 'down'))).toEqual({ key: 'login.errors.server' })
    expect(describeRequestsFailure(new TypeError('offline'))).toEqual({ key: 'login.errors.network' })
  })
})
