import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { BRANCH_ID, makeBranch, THREE_BRANCHES } from '../test/branches'
import { jsonResponse, mockFetch } from '../test/http'
import { createBranch, deleteBranch, listBranches, updateBranch } from './branches'

describe('branches API (API-080..API-083)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('lists the branches with the Bearer token and the abort signal, exactly as the server orders them', async () => {
    const items = THREE_BRANCHES()
    const fetchMock = mockFetch(() => jsonResponse(200, { items }))
    const controller = new AbortController()
    const result = await listBranches(controller.signal)
    expect(result.items.map((branch) => branch.code)).toEqual(['MAIN', 'NORTH', 'OLD'])
    const [[url, init]] = fetchMock.mock.calls
    expect(url).toBe('/api/branches')
    expect(init?.method).toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)
    expect(init?.credentials).toBe('include')
  })

  it('writes with the documented methods, paths and bodies; DELETE resolves on 204', async () => {
    const fetchMock = mockFetch((_url, init) => {
      if (init?.method === 'DELETE') return jsonResponse(204)
      return jsonResponse(init?.method === 'POST' ? 201 : 200, makeBranch())
    })
    await createBranch({ code: 'NORTH', name: { ar: 'الفرع الشمالي' }, isMain: true })
    await updateBranch(BRANCH_ID, { address: null, phone: null, timezone: 'Europe/Istanbul', isActive: false })
    await expect(deleteBranch(BRANCH_ID)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['/api/branches', 'POST', JSON.stringify({ code: 'NORTH', name: { ar: 'الفرع الشمالي' }, isMain: true })],
      [`/api/branches/${BRANCH_ID}`, 'PATCH', JSON.stringify({ address: null, phone: null, timezone: 'Europe/Istanbul', isActive: false })],
      [`/api/branches/${BRANCH_ID}`, 'DELETE', undefined],
    ])
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Content-Type')).toBe('application/json')
  })

  it('surfaces the stable error code and details of a refusal', async () => {
    mockFetch(() => jsonResponse(409, { statusCode: 409, error: 'Conflict', code: 'branch_is_main', message: 'main', branchId: BRANCH_ID, action: 'delete' }))
    await expect(deleteBranch(BRANCH_ID)).rejects.toMatchObject({ status: 409, code: 'branch_is_main', body: { action: 'delete' } })
  })
})
