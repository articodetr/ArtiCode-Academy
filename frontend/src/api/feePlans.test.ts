import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { FEE_PLAN_IDS, makeFeePlan, makeFeePlanList } from '../test/feePlans'
import { jsonResponse, mockFetch } from '../test/http'
import { CLASS_ID } from '../test/classes'
import { createFeePlan, deleteFeePlan, feePlansPath, listFeePlans, updateFeePlan } from './feePlans'

describe('fee plans API (API-140..API-143)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path with the given filters only', () => {
    expect(feePlansPath()).toBe('/api/fee-plans')
    expect(feePlansPath({ classId: CLASS_ID })).toBe(`/api/fee-plans?classId=${CLASS_ID}`)
    expect(feePlansPath({ courseId: 'c-1', classId: 'k-1' })).toBe('/api/fee-plans?courseId=c-1&classId=k-1')
  })

  it('lists the plans with the Bearer token and the abort signal, as the server orders them', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, makeFeePlanList()))
    const controller = new AbortController()
    const result = await listFeePlans({}, controller.signal)
    expect(result.items.map((plan) => plan.id)).toEqual([...FEE_PLAN_IDS])
    expect(result.items[0]?.total).toBe(1200)
    const [[url, init]] = fetchMock.mock.calls
    expect(url).toBe('/api/fee-plans')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)
  })

  it('writes with the documented methods, paths and bodies; DELETE resolves on 204', async () => {
    const fetchMock = mockFetch((_url, init) => (init?.method === 'DELETE' ? jsonResponse(204) : jsonResponse(init?.method === 'POST' ? 201 : 200, makeFeePlan())))
    const body = { name: { ar: 'خطة' }, classId: CLASS_ID, lines: [{ description: { ar: 'رسوم' }, amount: 1500 }], installments: [{ percent: 100, dueOffsetDays: 0 }] }
    await createFeePlan(body)
    await updateFeePlan(FEE_PLAN_IDS[0], { classId: null, isActive: false })
    await expect(deleteFeePlan(FEE_PLAN_IDS[0])).resolves.toBeUndefined()
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['/api/fee-plans', 'POST', JSON.stringify(body)],
      [`/api/fee-plans/${FEE_PLAN_IDS[0]}`, 'PATCH', JSON.stringify({ classId: null, isActive: false })],
      [`/api/fee-plans/${FEE_PLAN_IDS[0]}`, 'DELETE', undefined],
    ])
  })

  it('surfaces the stable code and details of a refusal (a used plan is not deleted)', async () => {
    mockFetch(() => jsonResponse(409, { statusCode: 409, error: 'Conflict', code: 'fee_plan_in_use', message: 'used', invoiceCount: 3 }))
    await expect(deleteFeePlan(FEE_PLAN_IDS[0])).rejects.toMatchObject({ status: 409, code: 'fee_plan_in_use', body: { invoiceCount: 3 } })
  })
})
