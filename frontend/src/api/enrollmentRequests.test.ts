// MOD-19 — the office's requests client (API-224/225): paths, parameters and the bearer header.
import { afterEach, describe, expect, it } from 'vitest'
import { jsonResponse, mockFetch } from '../test/http'
import { REQUEST_IDS, makeEnrollmentRequest, makeRequestList } from '../test/enrollmentRequests'
import { setAccessToken } from '../auth/token-store'
import { enrollmentRequestsPath, getEnrollmentRequest, listEnrollmentRequests } from './enrollmentRequests'

afterEach(() => setAccessToken(null))

describe('enrollment requests client', () => {
  it('builds the list path with the non-empty parameters only (trimmed search)', () => {
    expect(enrollmentRequestsPath()).toBe('/api/enrollment-requests')
    expect(enrollmentRequestsPath({ state: 'pending_payment', q: '  ليلى ', limit: 50, cursor: 'c1' })).toBe(
      `/api/enrollment-requests?state=pending_payment&q=${encodeURIComponent('ليلى')}&limit=50&cursor=c1`,
    )
    expect(enrollmentRequestsPath({ q: '   ', classId: 'k1', courseId: 'c1' })).toBe('/api/enrollment-requests?classId=k1&courseId=c1')
  })

  it('reads the list (API-224) and one request (API-225) with the bearer token', async () => {
    setAccessToken('tok-1', 'user-1')
    const calls: { url: string; auth: string | null }[] = []
    mockFetch((url, init) => {
      calls.push({ url, auth: new Headers(init?.headers).get('Authorization') })
      return url.includes(REQUEST_IDS[0]) ? jsonResponse(200, makeEnrollmentRequest()) : jsonResponse(200, makeRequestList([makeEnrollmentRequest()], 3))
    })
    const list = await listEnrollmentRequests({ state: 'all' })
    expect(list.pendingCount).toBe(3)
    expect(list.items[0]!.payment.invoices[0]!.number).toBe('INV-2026-00082')
    const one = await getEnrollmentRequest(REQUEST_IDS[0])
    expect(one.approveBlocker).toBe('payment_required')
    expect(calls.map((call) => call.url)).toEqual(['/api/enrollment-requests?state=all', `/api/enrollment-requests/${REQUEST_IDS[0]}`])
    expect(calls.every((call) => call.auth === 'Bearer tok-1')).toBe(true)
  })
})
