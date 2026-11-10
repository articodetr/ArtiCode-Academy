import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { GRADE_SCHEME_ID, makeGradeScheme, THREE_GRADE_SCHEMES } from '../test/gradeSchemes'
import { jsonResponse, mockFetch } from '../test/http'
import { createGradeScheme, deleteGradeScheme, listGradeSchemes, updateGradeScheme } from './gradeSchemes'

describe('grade schemes API (API-122..API-125)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('lists the schemes with the Bearer token and the abort signal, exactly as the server orders them', async () => {
    const items = THREE_GRADE_SCHEMES()
    const fetchMock = mockFetch(() => jsonResponse(200, { items }))
    const controller = new AbortController()
    const result = await listGradeSchemes(controller.signal)
    expect(result.items.map((scheme) => scheme.id)).toEqual(items.map((scheme) => scheme.id))
    expect(result.items[2]?.bands[1]?.minPercent).toBe(65.5)
    const [[url, init]] = fetchMock.mock.calls
    expect(url).toBe('/api/grade-schemes')
    expect(init?.method).toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)
    expect(init?.credentials).toBe('include')
  })

  it('writes with the documented methods, paths and bodies; DELETE resolves on 204', async () => {
    const fetchMock = mockFetch((_url, init) => {
      if (init?.method === 'DELETE') return jsonResponse(204)
      return jsonResponse(init?.method === 'POST' ? 201 : 200, makeGradeScheme())
    })
    const bands = [
      { minPercent: 0, label: { ar: 'راسب' }, isPass: false },
      { minPercent: 50, label: { ar: 'ناجح' }, letter: 'P', isPass: true },
    ]
    await createGradeScheme({ name: { ar: 'سلّم' }, bands, isDefault: true })
    await updateGradeScheme(GRADE_SCHEME_ID, { isDefault: true, isActive: true })
    await expect(deleteGradeScheme(GRADE_SCHEME_ID)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['/api/grade-schemes', 'POST', JSON.stringify({ name: { ar: 'سلّم' }, bands, isDefault: true })],
      [`/api/grade-schemes/${GRADE_SCHEME_ID}`, 'PATCH', JSON.stringify({ isDefault: true, isActive: true })],
      [`/api/grade-schemes/${GRADE_SCHEME_ID}`, 'DELETE', undefined],
    ])
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Content-Type')).toBe('application/json')
  })

  it('surfaces the stable error code and details of a refusal', async () => {
    mockFetch(() => jsonResponse(409, { statusCode: 409, error: 'Conflict', code: 'grade_scheme_in_use', message: 'used', finalGradeCount: 3 }))
    await expect(deleteGradeScheme(GRADE_SCHEME_ID)).rejects.toMatchObject({ status: 409, code: 'grade_scheme_in_use', body: { finalGradeCount: 3 } })
  })
})
