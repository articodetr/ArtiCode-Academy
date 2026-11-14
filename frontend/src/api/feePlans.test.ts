import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { FEE_PLAN_ID, makeFeePlan } from '../test/payments'
import { createFeePlan, deleteFeePlan, feePlansListPath, listFeePlans, updateFeePlan } from './feePlans'

describe('fee plans API (API-140..143)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path with its filters', () => {
    expect(feePlansListPath()).toBe('/api/fee-plans')
    expect(feePlansListPath({ courseId: 'c', classId: 'k' })).toBe('/api/fee-plans?courseId=c&classId=k')
  })

  it('sends the documented methods and bodies', async () => {
    const fetchMock = mockFetch((_, init) => (init?.method === 'DELETE' ? new Response(null, { status: 204 }) : jsonResponse(200, init?.method ? makeFeePlan() : { items: [makeFeePlan()] })))
    await listFeePlans()
    await createFeePlan({ name: { ar: 'خطة' }, lines: [{ description: { ar: 'رسوم' }, amount: 10 }], installments: [{ percent: 100, dueOffsetDays: 0 }] })
    await updateFeePlan(FEE_PLAN_ID, { isActive: false })
    await deleteFeePlan(FEE_PLAN_ID)
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['/api/fee-plans', 'GET'],
      ['/api/fee-plans', 'POST'],
      [`/api/fee-plans/${FEE_PLAN_ID}`, 'PATCH'],
      [`/api/fee-plans/${FEE_PLAN_ID}`, 'DELETE'],
    ])
    expect(fetchMock.mock.calls[2]![1]?.body).toBe(JSON.stringify({ isActive: false }))
  })
})
