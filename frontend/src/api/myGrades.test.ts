import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { makeFinalGrade, makeMyGradeItem, makeMyGradeList } from '../test/myGrades'
import { ApiError } from './client'
import { MY_GRADES_PERMISSIONS, listMyGrades, myGradesPath } from './myGrades'

describe('my grades API (API-129)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the path with the two filters only, in a fixed order — no pagination', () => {
    expect(myGradesPath()).toBe('/api/me/grades')
    expect(myGradesPath({ classId: '', studentId: undefined })).toBe('/api/me/grades')
    expect(myGradesPath({ studentId: 's-1', classId: 'c-1' })).toBe('/api/me/grades?classId=c-1&studentId=s-1')
    expect(myGradesPath({ studentId: 's 1' })).toBe('/api/me/grades?studentId=s+1')
  })

  it('reads the list with the Bearer token and the abort signal', async () => {
    const list = makeMyGradeList([makeMyGradeItem({ final: makeFinalGrade() })])
    const fetchMock = mockFetch(() => jsonResponse(200, list))
    const controller = new AbortController()
    await expect(listMyGrades({ classId: 'c-1' }, controller.signal)).resolves.toEqual(list)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/me/grades?classId=c-1')
    expect(init?.method ?? 'GET').toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)
  })

  it('surfaces the refusal of a caller holding neither grades key as permission_denied with both keys missing', async () => {
    expect(MY_GRADES_PERMISSIONS).toEqual(['grades.read_own', 'grades.read_linked'])
    mockFetch(() => jsonResponse(403, { statusCode: 403, error: 'Forbidden', code: 'permission_denied', message: 'Missing permission', missing: [...MY_GRADES_PERMISSIONS] }))
    const refused = await listMyGrades().catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(ApiError)
    expect((refused as ApiError).status).toBe(403)
    expect((refused as ApiError).code).toBe('permission_denied')
    expect((refused as ApiError).body).toMatchObject({ missing: ['grades.read_own', 'grades.read_linked'] })
  })
})
